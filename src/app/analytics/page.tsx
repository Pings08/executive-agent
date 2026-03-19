'use client';

import { useMemo } from 'react';
import { useApp } from '@/store/AppContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts';
import { TrendingUp, CheckCircle, Clock, AlertTriangle, Users, Target } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const COLORS = ['#10B981', '#F59E0B', '#EF4444', '#64748B', '#2D5A87'];

export default function AnalyticsPage() {
  const { objectives, employees, workUpdates, notes } = useApp();

  const statusData = useMemo(() => {
    const allSubPoints = objectives.flatMap(o => o.subPoints);
    const statuses = ['completed', 'in_progress', 'blocked', 'not_started'];
    const labels = ['Completed', 'In Progress', 'Blocked', 'Not Started'];
    
    return statuses.map((status, idx) => ({
      name: labels[idx],
      value: allSubPoints.filter(sp => sp.status === status).length,
      color: COLORS[idx],
    }));
  }, [objectives]);

  const employeeData = useMemo(() => {
    return employees.map(emp => {
      const empUpdates = workUpdates.filter(u => u.employeeId === emp.id);
      const empSubPoints = objectives.flatMap(o => o.subPoints.filter(sp => sp.assigneeId === emp.id));
      const completed = empSubPoints.filter(sp => sp.status === 'completed').length;
      
      return {
        id: emp.id,
        name: emp.name,
        updates: empUpdates.length,
        completed: completed,
        total: empSubPoints.length,
      };
    });
  }, [employees, workUpdates, objectives]);

  const progressData = useMemo(() => {
    const days = 7;
    const data = [];
    const today = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = format(date, 'yyyy-MM-dd');
      
      const dayUpdates = workUpdates.filter(u => u.createdAt.split('T')[0] === dateStr);
      const dayCompleted = objectives.flatMap(o => o.subPoints).filter(sp => {
        const updated = parseISO(sp.updatedAt);
        return format(updated, 'yyyy-MM-dd') === dateStr && sp.status === 'completed';
      }).length;
      
      data.push({
        date: format(date, 'MMM d'),
        updates: dayUpdates.length,
        completed: dayCompleted,
      });
    }
    
    return data;
  }, [workUpdates, objectives]);

  const priorityData = useMemo(() => {
    const priorities = ['critical', 'high', 'medium', 'low'];
    const labels = ['Critical', 'High', 'Medium', 'Low'];
    
    return priorities.map((priority, idx) => ({
      name: labels[idx],
      value: objectives.filter(o => o.priority === priority).length,
      color: COLORS[idx],
    }));
  }, [objectives]);

  const totalSubPoints = objectives.reduce((acc, obj) => acc + obj.subPoints.length, 0);
  const completedSubPoints = objectives.reduce((acc, obj) => acc + obj.subPoints.filter(sp => sp.status === 'completed').length, 0);
  const overallProgress = totalSubPoints > 0 ? Math.round((completedSubPoints / totalSubPoints) * 100) : 0;

  const avgRating = notes.length > 0 
    ? (notes.reduce((acc, n) => acc + n.rating, 0) / notes.length).toFixed(1)
    : 'N/A';

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-heading font-bold">Analytics</h1>
          <p className="text-text-secondary mt-1">Track progress and performance metrics</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-success/20 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-text-secondary text-sm">Overall Progress</p>
              <p className="text-2xl font-bold">{overallProgress}%</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-warning/20 rounded-lg flex items-center justify-center">
              <Target className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-text-secondary text-sm">Total Sub-Points</p>
              <p className="text-2xl font-bold">{totalSubPoints}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-secondary/20 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-secondary" />
            </div>
            <div>
              <p className="text-text-secondary text-sm">Team Members</p>
              <p className="text-2xl font-bold">{employees.length}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-accent/20 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-accent" />
            </div>
            <div>
              <p className="text-text-secondary text-sm">Avg Rating</p>
              <p className="text-2xl font-bold">{avgRating}/5</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-lg font-heading font-semibold mb-6">Sub-Point Status Distribution</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}
                  itemStyle={{ color: '#F8FAFC' }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-heading font-semibold mb-6">Employee Performance</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={employeeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94A3B8" />
                <YAxis stroke="#94A3B8" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}
                  itemStyle={{ color: '#F8FAFC' }}
                />
                <Legend />
                <Bar dataKey="completed" fill="#10B981" name="Completed" />
                <Bar dataKey="total" fill="#2D5A87" name="Total" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-lg font-heading font-semibold mb-6">Progress Over Time</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={progressData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" stroke="#94A3B8" />
                <YAxis stroke="#94A3B8" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}
                  itemStyle={{ color: '#F8FAFC' }}
                />
                <Legend />
                <Line type="monotone" dataKey="updates" stroke="#FF6B35" name="Updates" strokeWidth={2} />
                <Line type="monotone" dataKey="completed" stroke="#10B981" name="Completed" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-heading font-semibold mb-6">Objectives by Priority</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={priorityData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" stroke="#94A3B8" />
                <YAxis dataKey="name" type="category" stroke="#94A3B8" width={60} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}
                  itemStyle={{ color: '#F8FAFC' }}
                />
                <Bar dataKey="value" fill="#2D5A87" name="Objectives">
                  {priorityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-heading font-semibold mb-6">Employee Activity</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-3 text-sm font-medium text-text-secondary">Employee</th>
                <th className="text-left p-3 text-sm font-medium text-text-secondary">Role</th>
                <th className="text-center p-3 text-sm font-medium text-text-secondary">Updates</th>
                <th className="text-center p-3 text-sm font-medium text-text-secondary">Tasks</th>
                <th className="text-center p-3 text-sm font-medium text-text-secondary">Completed</th>
                <th className="text-center p-3 text-sm font-medium text-text-secondary">Progress</th>
              </tr>
            </thead>
            <tbody>
              {employeeData.map((emp, idx) => {
                const progress = emp.total > 0 ? Math.round((emp.completed / emp.total) * 100) : 0;
                const employee = employees[idx];
                return (
                  <tr key={emp.id} className="border-b border-border hover:bg-surface/50">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-secondary/50 rounded-full flex items-center justify-center text-sm">
                          {employee?.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <span className="font-medium">{employee?.name}</span>
                      </div>
                    </td>
                    <td className="p-3 text-text-secondary text-sm">{employee?.role}</td>
                    <td className="p-3 text-center">{emp.updates}</td>
                    <td className="p-3 text-center">{emp.total}</td>
                    <td className="p-3 text-center text-success">{emp.completed}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 progress-bar">
                          <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                        </div>
                        <span className="text-sm text-text-secondary">{progress}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}