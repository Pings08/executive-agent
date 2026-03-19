import { SupabaseClient } from '@supabase/supabase-js';
import { DbEmployee } from '@/types/database';
import { Employee } from '@/types';

export function mapDbEmployeeToEmployee(dbEmp: DbEmployee): Employee {
  return {
    id: dbEmp.id,
    name: dbEmp.name,
    email: dbEmp.email ?? '',
    role: dbEmp.role,
    avatar: dbEmp.avatar_url ?? undefined,
    status: dbEmp.status,
    ravenUser: dbEmp.raven_user ?? undefined,
    dateOfJoining: dbEmp.date_of_joining ?? undefined,
    createdAt: dbEmp.created_at,
  };
}

export async function fetchEmployees(supabase: SupabaseClient): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .order('name');

  if (error) throw error;
  return (data || []).map(mapDbEmployeeToEmployee);
}

export async function fetchEmployeeById(supabase: SupabaseClient, id: string): Promise<Employee | null> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return mapDbEmployeeToEmployee(data);
}

export async function upsertEmployee(
  supabase: SupabaseClient,
  employee: Partial<DbEmployee> & { erp_id: string; name: string }
): Promise<DbEmployee | null> {
  const { data, error } = await supabase
    .from('employees')
    .upsert(employee, { onConflict: 'erp_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}
