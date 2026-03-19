import { NextResponse } from 'next/server';

export async function POST() {
  const base = process.env.ERPNEXT_BASE_URL!;
  const key = process.env.ERPNEXT_API_KEY!;
  const secret = process.env.ERPNEXT_API_SECRET!;
  const headers = {
    'Authorization': `token ${key}:${secret}`,
    'Content-Type': 'application/json',
  };

  const results: Record<string, unknown> = {};

  // Test 1: fetch messages NOT from satyam — are there any?
  try {
    const r = await fetch(
      `${base}/api/resource/Raven%20Message?fields=["name","owner","content","channel_id"]&filters=[["owner","!=","satyam@technoculture.io"]]&limit_page_length=10`,
      { headers }
    );
    const d = await r.json();
    results.nonSatyamMessages = { count: d.data?.length, owners: d.data?.map((m: Record<string, string>) => m.owner), sample: d.data?.slice(0,3) };
  } catch (e) { results.nonSatyamError = String(e); }

  // Test 2: total message count in DB
  try {
    const r = await fetch(
      `${base}/api/resource/Raven%20Message?fields=["name"]&limit_page_length=500&filters=[["owner","!=","satyam@technoculture.io"]]`,
      { headers }
    );
    const d = await r.json();
    results.totalNonSatyam = d.data?.length;
  } catch (e) { results.totalNonSatyamError = String(e); }

  // Test 3: fetch from a specific group channel (not DM)
  // Using channel_id = Raven-general (the actual stored value we saw)
  try {
    const r = await fetch(
      `${base}/api/resource/Raven%20Message?fields=["name","owner","content"]&filters=[["channel_id","=","Raven-general"]]&limit_page_length=20`,
      { headers }
    );
    const d = await r.json();
    const owners = [...new Set((d.data || []).map((m: Record<string, string>) => m.owner))];
    results.generalChannel = { count: d.data?.length, uniqueOwners: owners };
  } catch (e) { results.generalChannelError = String(e); }

  // Test 4: try fetching oldest messages first (maybe other users messaged long ago)
  try {
    const r = await fetch(
      `${base}/api/resource/Raven%20Message?fields=["name","owner","channel_id","creation"]&limit_page_length=20&order_by=creation+asc`,
      { headers }
    );
    const d = await r.json();
    const owners = [...new Set((d.data || []).map((m: Record<string, string>) => m.owner))];
    results.oldestMessages = { count: d.data?.length, uniqueOwners: owners, sample: d.data?.slice(0,5)?.map((m: Record<string, string>) => ({ owner: m.owner, channel: m.channel_id, time: m.creation })) };
  } catch (e) { results.oldestError = String(e); }

  // Test 5: Check if there's a Raven-specific get_list hook by using frappe.client.get_list
  try {
    const r = await fetch(
      `${base}/api/method/frappe.client.get_list?doctype=Raven%20Message&filters=[["owner","!=","satyam@technoculture.io"]]&fields=["name","owner"]&limit_page_length=5`,
      { headers }
    );
    const d = await r.json();
    results.frappeclientNonSatyam = { status: r.status, data: d.message };
  } catch (e) { results.frappeclientError = String(e); }

  return NextResponse.json(results);
}
