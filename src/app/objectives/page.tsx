'use client';

import { useState } from 'react';
import { useApp } from '@/store/AppContext';
import { Plus, X, ChevronDown, ChevronRight, Trash2, Clock, AlertTriangle, Sparkles, Activity } from 'lucide-react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import type { Objective, SubPoint, Status, Priority } from '@/types';

function getStatusColor(status: Status) {
  switch (status) {
    case 'completed': return 'success';
    case 'in_progress': return 'warning';
    case 'blocked': return 'error';
    default: return 'gray';
  }
}

function getStatusLabel(status: Status) {
  switch (status) {
    case 'completed': return 'Completed';
    case 'in_progress': return 'In Progress';
    case 'blocked': return 'Blocked';
    default: return 'Not Started';
  }
}

function getPriorityColor(priority: Priority) {
  switch (priority) {
    case 'critical': return 'error';
    case 'high': return 'warning';
    case 'medium': return 'info';
    default: return 'gray';
  }
}

export default function ObjectivesPage() {
  const { objectives, employees, addObjective, updateObjective, deleteObjective, addSubPoint, updateSubPoint, deleteSubPoint, addNestedSubPoint, updateNestedSubPoint, deleteNestedSubPoint } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [showSubPointModal, setShowSubPointModal] = useState(false);
  const [showNestedSubPointModal, setShowNestedSubPointModal] = useState(false);
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(null);
  const [selectedParentSubPointId, setSelectedParentSubPointId] = useState<string | null>(null);
  const [expandedObjective, setExpandedObjective] = useState<string | null>(null);
  const [expandedSubPoints, setExpandedSubPoints] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    priority: 'medium' as Priority,
    status: 'not_started' as Status,
    assigneeIds: [] as string[],
  });
  const [subPointForm, setSubPointForm] = useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    assigneeId: '',
    status: 'not_started' as Status,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addObjective(formData);
    setShowModal(false);
    setFormData({
      title: '',
      description: '',
      startDate: '',
      endDate: '',
      priority: 'medium',
      status: 'not_started',
      assigneeIds: [],
    });
  };

  const handleSubPointSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedObjectiveId) {
      addSubPoint(selectedObjectiveId, subPointForm as Omit<SubPoint, 'id' | 'createdAt' | 'updatedAt'>);
    }
    setShowSubPointModal(false);
    setSubPointForm({
      title: '',
      description: '',
      startDate: '',
      endDate: '',
      assigneeId: '',
      status: 'not_started',
    });
  };

  const handleNestedSubPointSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedObjectiveId && selectedParentSubPointId) {
      addNestedSubPoint(selectedObjectiveId, selectedParentSubPointId, subPointForm as Omit<SubPoint, 'id' | 'createdAt' | 'updatedAt'>);
    }
    setShowNestedSubPointModal(false);
    setSelectedParentSubPointId(null);
    setSubPointForm({
      title: '',
      description: '',
      startDate: '',
      endDate: '',
      assigneeId: '',
      status: 'not_started',
    });
  };

  const openSubPointModal = (objectiveId: string) => {
    setSelectedObjectiveId(objectiveId);
    setShowSubPointModal(true);
  };

  const openNestedSubPointModal = (objectiveId: string, parentSubPointId: string) => {
    setSelectedObjectiveId(objectiveId);
    setSelectedParentSubPointId(parentSubPointId);
    setShowNestedSubPointModal(true);
  };

  const toggleSubPointExpand = (subPointId: string) => {
    setExpandedSubPoints(prev => {
      const newSet = new Set(prev);
      if (newSet.has(subPointId)) {
        newSet.delete(subPointId);
      } else {
        newSet.add(subPointId);
      }
      return newSet;
    });
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-heading font-bold">Objectives</h1>
          <p className="text-text-secondary mt-1">Manage your strategic objectives and sub-points</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-5 h-5" />
          Add Objective
        </button>
      </div>

      <div className="space-y-4">
        {objectives.map((objective) => {
          // Use AI-tracked progress_percentage if available, else fall back to task completion ratio
          const aiProgress = (objective.progressPercentage ?? 0);
          const taskProgress = objective.subPoints.length > 0
            ? Math.round((objective.subPoints.filter(sp => sp.status === 'completed').length / objective.subPoints.length) * 100)
            : 0;
          const progress = aiProgress > 0 ? aiProgress : taskProgress;
          const isExpanded = expandedObjective === objective.id;

          return (
            <div key={objective.id} className="card">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <button
                      onClick={() => setExpandedObjective(isExpanded ? null : objective.id)}
                      className="p-1 hover:bg-background rounded"
                    >
                      {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    </button>
                    <h3 className="text-lg font-semibold">{objective.title}</h3>
                    <span className={`badge badge-${getPriorityColor(objective.priority)}`}>{objective.priority}</span>
                    <span className={`badge badge-${getStatusColor(objective.status)}`}>{getStatusLabel(objective.status)}</span>
                  </div>
                  <p className="text-text-secondary mb-3 ml-8">{objective.description}</p>

                  {/* AI Summary */}
                  {objective.aiSummary && (
                    <div className="ml-8 mb-3 flex items-start gap-2 text-sm bg-accent/5 border border-accent/20 rounded-lg px-3 py-2">
                      <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                      <p className="text-text-secondary leading-snug">{objective.aiSummary}</p>
                    </div>
                  )}

                  <div className="flex items-center gap-4 ml-8 text-sm text-text-secondary">
                    {objective.startDate && objective.endDate && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {format(parseISO(objective.startDate), 'MMM d')} - {format(parseISO(objective.endDate), 'MMM d, yyyy')}
                      </span>
                    )}
                    <span>{objective.subPoints.length} sub-points</span>
                    {objective.lastActivityAt && (
                      <span className="flex items-center gap-1 text-accent/70">
                        <Activity className="w-3.5 h-3.5" />
                        {formatDistanceToNow(parseISO(objective.lastActivityAt), { addSuffix: true })}
                      </span>
                    )}
                    <span>Assigned: {objective.assigneeIds.map(id => employees.find(e => e.id === id)?.name).filter(Boolean).join(', ')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openSubPointModal(objective.id)}
                    className="btn-secondary text-sm"
                  >
                    Add Sub-Point
                  </button>
                  <button
                    onClick={() => deleteObjective(objective.id)}
                    className="p-2 text-error hover:bg-error/10 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-border ml-8">
                  <div className="mb-4">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="flex items-center gap-1.5">
                        Progress
                        {aiProgress > 0 && (
                          <span className="flex items-center gap-1 text-[10px] text-accent font-medium">
                            <Sparkles className="w-3 h-3" /> AI-tracked
                          </span>
                        )}
                      </span>
                      <span>{progress}%</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                    </div>
                  </div>

                  {objective.subPoints.length > 0 ? (
                    <div className="space-y-3">
                      {objective.subPoints.map((subPoint) => {
                        const assignee = employees.find(e => e.id === subPoint.assigneeId);
                        const hasNested = subPoint.subPoints && subPoint.subPoints.length > 0;
                        const isSubPointExpanded = expandedSubPoints.has(subPoint.id);
                        
                        return (
                          <div key={subPoint.id} className="p-3 bg-background rounded-lg border border-border">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 flex-1">
                                {hasNested && (
                                  <button
                                    onClick={() => toggleSubPointExpand(subPoint.id)}
                                    className="p-1 hover:bg-surface rounded"
                                  >
                                    {isSubPointExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                  </button>
                                )}
                                {!hasNested && <div className="w-5" />}
                                <h4 className="font-medium">{subPoint.title}</h4>
                                <span className={`badge badge-${getStatusColor(subPoint.status)} text-xs`}>{getStatusLabel(subPoint.status)}</span>
                                {(subPoint.progressPercentage ?? 0) > 0 && (
                                  <span className="text-xs text-accent/70">{subPoint.progressPercentage}%</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => openNestedSubPointModal(objective.id, subPoint.id)}
                                  className="btn-ghost text-xs py-1 px-2"
                                >
                                  + Add
                                </button>
                                <select
                                  value={subPoint.status}
                                  onChange={(e) => updateSubPoint(objective.id, subPoint.id, { status: e.target.value as Status })}
                                  className="input text-sm py-1 px-2 w-auto"
                                >
                                  <option value="not_started">Not Started</option>
                                  <option value="in_progress">In Progress</option>
                                  <option value="completed">Completed</option>
                                  <option value="blocked">Blocked</option>
                                </select>
                                <button
                                  onClick={() => deleteSubPoint(objective.id, subPoint.id)}
                                  className="p-1 text-error hover:bg-error/10 rounded"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            <p className="text-sm text-text-secondary mt-1 ml-7">{subPoint.description}</p>
                            <div className="flex items-center gap-3 mt-2 ml-7 text-xs text-text-secondary">
                              <span>{assignee?.name || 'Unassigned'}</span>
                              <span>{subPoint.startDate && subPoint.endDate ? `${format(parseISO(subPoint.startDate), 'MMM d')} - ${format(parseISO(subPoint.endDate), 'MMM d')}` : 'No dates'}</span>
                            </div>
                            
                            {/* Nested Sub-Points */}
                            {hasNested && isSubPointExpanded && (
                              <div className="ml-8 mt-3 space-y-2 border-l-2 border-border pl-4">
                                {subPoint.subPoints!.map((nestedSp) => {
                                  const nestedAssignee = employees.find(e => e.id === nestedSp.assigneeId);
                                  return (
                                    <div key={nestedSp.id} className="p-2 bg-surface rounded border border-border/50 flex items-center justify-between">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                          <h5 className="text-sm font-medium">{nestedSp.title}</h5>
                                          <span className={`badge badge-${getStatusColor(nestedSp.status)} text-xs`}>{getStatusLabel(nestedSp.status)}</span>
                                        </div>
                                        <p className="text-xs text-text-secondary mt-1">{nestedSp.description}</p>
                                        <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary">
                                          <span>{nestedAssignee?.name || 'Unassigned'}</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <select
                                          value={nestedSp.status}
                                          onChange={(e) => updateNestedSubPoint(objective.id, subPoint.id, nestedSp.id, { status: e.target.value as Status })}
                                          className="input text-xs py-1 px-1 w-auto"
                                        >
                                          <option value="not_started">Not Started</option>
                                          <option value="in_progress">In Progress</option>
                                          <option value="completed">Completed</option>
                                          <option value="blocked">Blocked</option>
                                        </select>
                                        <button
                                          onClick={() => deleteNestedSubPoint(objective.id, subPoint.id, nestedSp.id)}
                                          className="p-1 text-error hover:bg-error/10 rounded"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-text-secondary text-center py-4">No sub-points yet</p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {objectives.length === 0 && (
          <div className="card text-center py-12">
            <AlertTriangle className="w-12 h-12 text-text-secondary mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No objectives yet</h3>
            <p className="text-text-secondary mb-4">Create your first objective to get started</p>
            <button onClick={() => setShowModal(true)} className="btn-primary">
              Add Objective
            </button>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content animate-fadeIn" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-heading font-semibold">Create New Objective</h2>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-background rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Title</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input min-h-[100px]"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Start Date</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">End Date</label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="input"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Priority</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as Priority })}
                    className="input"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as Status })}
                    className="input"
                  >
                    <option value="not_started">Not Started</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Assign Team Members</label>
                <div className="flex flex-wrap gap-2">
                  {employees.map((employee) => (
                    <label key={employee.id} className="flex items-center gap-2 p-2 bg-background rounded-lg border border-border cursor-pointer hover:border-accent">
                      <input
                        type="checkbox"
                        checked={formData.assigneeIds.includes(employee.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({ ...formData, assigneeIds: [...formData.assigneeIds, employee.id] });
                          } else {
                            setFormData({ ...formData, assigneeIds: formData.assigneeIds.filter(id => id !== employee.id) });
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">{employee.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button type="submit" className="btn-primary w-full">Create Objective</button>
            </form>
          </div>
        </div>
      )}

      {showSubPointModal && (
        <div className="modal-overlay" onClick={() => setShowSubPointModal(false)}>
          <div className="modal-content animate-fadeIn" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-heading font-semibold">Add Sub-Point</h2>
              <button onClick={() => setShowSubPointModal(false)} className="p-2 hover:bg-background rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubPointSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Title</label>
                <input
                  type="text"
                  value={subPointForm.title}
                  onChange={(e) => setSubPointForm({ ...subPointForm, title: e.target.value })}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={subPointForm.description}
                  onChange={(e) => setSubPointForm({ ...subPointForm, description: e.target.value })}
                  className="input min-h-[80px]"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Start Date</label>
                  <input
                    type="date"
                    value={subPointForm.startDate}
                    onChange={(e) => setSubPointForm({ ...subPointForm, startDate: e.target.value })}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">End Date</label>
                  <input
                    type="date"
                    value={subPointForm.endDate}
                    onChange={(e) => setSubPointForm({ ...subPointForm, endDate: e.target.value })}
                    className="input"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Assign To</label>
                <select
                  value={subPointForm.assigneeId}
                  onChange={(e) => setSubPointForm({ ...subPointForm, assigneeId: e.target.value })}
                  className="input"
                  required
                >
                  <option value="">Select team member</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.name}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn-primary w-full">Add Sub-Point</button>
            </form>
          </div>
        </div>
      )}

      {showNestedSubPointModal && (
        <div className="modal-overlay" onClick={() => setShowNestedSubPointModal(false)}>
          <div className="modal-content animate-fadeIn" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-heading font-semibold">Add Sub-Point</h2>
              <button onClick={() => setShowNestedSubPointModal(false)} className="p-2 hover:bg-background rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleNestedSubPointSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Title</label>
                <input
                  type="text"
                  value={subPointForm.title}
                  onChange={(e) => setSubPointForm({ ...subPointForm, title: e.target.value })}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={subPointForm.description}
                  onChange={(e) => setSubPointForm({ ...subPointForm, description: e.target.value })}
                  className="input min-h-[80px]"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Start Date</label>
                  <input
                    type="date"
                    value={subPointForm.startDate}
                    onChange={(e) => setSubPointForm({ ...subPointForm, startDate: e.target.value })}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">End Date</label>
                  <input
                    type="date"
                    value={subPointForm.endDate}
                    onChange={(e) => setSubPointForm({ ...subPointForm, endDate: e.target.value })}
                    className="input"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Assign To</label>
                <select
                  value={subPointForm.assigneeId}
                  onChange={(e) => setSubPointForm({ ...subPointForm, assigneeId: e.target.value })}
                  className="input"
                  required
                >
                  <option value="">Select team member</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.name}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn-primary w-full">Add Sub-Point</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}