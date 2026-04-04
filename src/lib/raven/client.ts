export class RavenClient {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;

  constructor(apiKey?: string, apiSecret?: string) {
    this.baseUrl = process.env.ERPNEXT_BASE_URL!;
    // Allow per-user key override — used to fetch each employee's own messages
    this.apiKey = apiKey || process.env.ERPNEXT_API_KEY!;
    this.apiSecret = apiSecret || process.env.ERPNEXT_API_SECRET!;
  }

  private async fetchFromERP<T>(
    doctype: string,
    params: Record<string, string>
  ): Promise<T[]> {
    const url = new URL(`${this.baseUrl}/api/resource/${encodeURIComponent(doctype)}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url.toString(), {
          headers: {
            'Authorization': `token ${this.apiKey}:${this.apiSecret}`,
            'Content-Type': 'application/json',
          },
        });
        if (!response.ok) {
          if (response.status >= 500 && attempt < 2) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
            continue;
          }
          throw new Error(`ERPNext API error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return data.data || [];
      } catch (error) {
        lastError = error as Error;
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }
    throw lastError;
  }

  // Calls the custom Frappe Server Script (get_all_raven_messages) which uses
  // frappe.db.sql() to bypass Raven's Python get_list hook that restricts
  // results to the authenticated user's own messages.
  private async fetchMessagesViaServerScript(
    afterCreation?: string,
    limit = 500
  ): Promise<Record<string, unknown>[]> {
    const body: Record<string, string> = { limit: String(Math.min(limit, 1000)) };
    if (afterCreation) body.after_creation = afterCreation;

    const response = await fetch(
      `${this.baseUrl}/api/method/get_all_raven_messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${this.apiKey}:${this.apiSecret}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(body).toString(),
      }
    );

    if (!response.ok) {
      throw new Error(`Server Script ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    if (!Array.isArray(data.message)) {
      throw new Error('Server Script returned unexpected format');
    }
    return data.message as Record<string, unknown>[];
  }

  async fetchMessages(afterCreation?: string, limit = 100): Promise<Record<string, unknown>[]> {
    // Try the custom Server Script first — it fetches ALL users' messages
    // by bypassing Raven's owner-restriction hook via direct SQL.
    try {
      const msgs = await this.fetchMessagesViaServerScript(afterCreation, Math.max(limit, 500));
      return msgs;
    } catch {
      // Server Script not set up yet → fall back to standard endpoint (own messages only)
    }

    // Standard fallback: only returns the API key owner's messages
    const filters: unknown[][] = [];
    if (afterCreation) {
      filters.push(['creation', '>', afterCreation]);
    }

    const params: Record<string, string> = {
      fields: JSON.stringify(['name', 'content', 'text', 'message_type', 'owner', 'creation', 'modified', 'channel_id', 'file']),
      order_by: 'creation asc',
      limit_page_length: String(limit),
    };
    if (filters.length > 0) {
      params.filters = JSON.stringify(filters);
    }

    return this.fetchFromERP<Record<string, unknown>>('Raven Message', params);
  }

  async fetchChannels(): Promise<Record<string, unknown>[]> {
    return this.fetchFromERP<Record<string, unknown>>('Raven Channel', {
      fields: JSON.stringify(['name', 'channel_name', 'type']),
      limit_page_length: '200',
    });
  }

  async fetchEmployees(): Promise<Record<string, unknown>[]> {
    // Try Raven Channel Member first (always accessible), fall back to User doctype
    try {
      const members = await this.fetchFromERP<Record<string, unknown>>('Raven Channel Member', {
        fields: JSON.stringify(['name', 'user_id']),
        limit_page_length: '500',
      });
      // Deduplicate by user_id
      const seen = new Set<string>();
      const unique = members.filter(m => {
        const uid = String(m.user_id || m.name || '');
        if (!uid || seen.has(uid)) return false;
        seen.add(uid);
        return true;
      });
      // Fetch full user details
      const users: Record<string, unknown>[] = [];
      for (const m of unique.slice(0, 100)) {
        try {
          const uid = String(m.user_id || m.name);
          const userList = await this.fetchFromERP<Record<string, unknown>>('User', {
            filters: JSON.stringify([['name', '=', uid]]),
            fields: JSON.stringify(['name', 'full_name', 'email', 'user_image']),
            limit_page_length: '1',
          });
          if (userList[0]) {
            users.push({
              name: userList[0].name,
              employee_name: userList[0].full_name || userList[0].name,
              email_id: userList[0].email,
              designation: 'Team Member',
              user_id: userList[0].name,
              status: 'active',
            });
          }
        } catch { /* skip individual user fetch errors */ }
      }
      return users.length > 0 ? users : unique.map(m => ({
        name: String(m.user_id || m.name),
        employee_name: String(m.user_id || m.name),
        email_id: null,
        designation: 'Team Member',
        user_id: String(m.user_id || m.name),
        status: 'active',
      }));
    } catch {
      // Final fallback: User doctype directly
      return this.fetchFromERP<Record<string, unknown>>('User', {
        fields: JSON.stringify(['name', 'full_name', 'email', 'user_image']),
        filters: JSON.stringify([['enabled', '=', 1]]),
        limit_page_length: '200',
      }).then(users => users.map(u => ({
        name: u.name,
        employee_name: u.full_name || u.name,
        email_id: u.email,
        designation: 'Team Member',
        user_id: u.name,
        status: 'active',
      })));
    }
  }

  async fetchProjects(): Promise<Record<string, unknown>[]> {
    try {
      return await this.fetchFromERP<Record<string, unknown>>('Project', {
        fields: JSON.stringify(['name', 'project_name', 'description', 'status', 'priority', 'expected_start_date', 'exp_end_date']),
        limit_page_length: '200',
      });
    } catch {
      // Projects may not be accessible — return empty, objectives can be added manually
      return [];
    }
  }

  async fetchTasks(): Promise<Record<string, unknown>[]> {
    return this.fetchFromERP<Record<string, unknown>>('Task', {
      fields: JSON.stringify(['name', 'subject', 'description', 'status', 'project', 'exp_start_date', 'exp_end_date', '_assign']),
      limit_page_length: '500',
    });
  }
}
