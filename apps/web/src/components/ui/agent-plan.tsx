// argo:upstream 21st.dev@agent-plan
// Renders the WorkflowMap as a list of expandable steps (and substeps).
// Used in the workspace's left sidebar so the user always sees what Argo
// is *about* to do, what it just did, and what's awaiting their approval.
import React, { useState } from 'react';
import { CheckCircle2, Circle, CircleAlert, CircleDotDashed, CircleX } from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { cn } from '../../lib/utils.js';

export type AgentTaskStatus = 'pending' | 'in-progress' | 'completed' | 'need-help' | 'failed';

export interface AgentSubtask {
  id: string;
  title: string;
  description: string;
  status: AgentTaskStatus;
  tools?: string[];
}

export interface AgentTask {
  id: string;
  title: string;
  description: string;
  status: AgentTaskStatus;
  level: number;
  dependencies: string[];
  subtasks: AgentSubtask[];
}

interface AgentPlanProps {
  tasks: AgentTask[];
  initialExpandedIds?: string[];
  onToggleStatus?: (taskId: string) => void;
  onToggleSubtaskStatus?: (taskId: string, subtaskId: string) => void;
}

const statusIcon = (status: AgentTaskStatus, size: 'sm' | 'lg' = 'lg') => {
  const cls = size === 'sm' ? 'h-3.5 w-3.5' : 'h-[18px] w-[18px]';
  switch (status) {
    case 'completed':
      return <CheckCircle2 className={cn(cls, 'text-argo-green')} />;
    case 'in-progress':
      return <CircleDotDashed className={cn(cls, 'text-argo-accent')} />;
    case 'need-help':
      return <CircleAlert className={cn(cls, 'text-argo-amber')} />;
    case 'failed':
      return <CircleX className={cn(cls, 'text-argo-red')} />;
    default:
      return <Circle className={cn(cls, 'text-argo-textSecondary')} />;
  }
};

const statusBadgeClass = (status: AgentTaskStatus) => {
  switch (status) {
    case 'completed':
      return 'bg-argo-green/15 text-argo-green';
    case 'in-progress':
      return 'bg-argo-accent/15 text-argo-accent';
    case 'need-help':
      return 'bg-argo-amber/15 text-argo-amber';
    case 'failed':
      return 'bg-argo-red/15 text-argo-red';
    default:
      return 'bg-argo-surfaceAlt text-argo-textSecondary';
  }
};

export function AgentPlan({
  tasks,
  initialExpandedIds = [],
  onToggleStatus,
  onToggleSubtaskStatus,
}: AgentPlanProps) {
  const [expandedTasks, setExpandedTasks] = useState<string[]>(initialExpandedIds);
  const [expandedSubtasks, setExpandedSubtasks] = useState<Record<string, boolean>>({});
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const toggleTaskExpansion = (taskId: string) =>
    setExpandedTasks((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );

  const toggleSubtaskExpansion = (taskId: string, subtaskId: string) => {
    const key = `${taskId}-${subtaskId}`;
    setExpandedSubtasks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const taskVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : -5 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },
    exit: { opacity: 0, y: prefersReducedMotion ? 0 : -5, transition: { duration: 0.15 } },
  };

  return (
    <div className="text-argo-text h-full overflow-auto">
      <motion.div
        className="bg-argo-surface border border-argo-border rounded-lg overflow-hidden"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.3 } }}
      >
        <LayoutGroup>
          <div className="p-3">
            <ul className="space-y-1">
              {tasks.map((task, index) => {
                const isExpanded = expandedTasks.includes(task.id);
                const isCompleted = task.status === 'completed';
                return (
                  <motion.li
                    key={task.id}
                    className={index !== 0 ? 'mt-1 pt-2' : ''}
                    initial="hidden"
                    animate="visible"
                    variants={taskVariants}
                  >
                    <div className="group flex items-center px-2 py-1.5 rounded-md hover:bg-argo-surfaceAlt/60">
                      <button
                        type="button"
                        className="mr-2 flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStatus?.(task.id);
                        }}
                        aria-label="Toggle status"
                      >
                        {statusIcon(task.status)}
                      </button>
                      <button
                        type="button"
                        className="flex min-w-0 flex-grow items-center justify-between text-left"
                        onClick={() => toggleTaskExpansion(task.id)}
                      >
                        <span
                          className={cn(
                            'mr-2 flex-1 truncate text-sm',
                            isCompleted && 'line-through text-argo-textSecondary',
                          )}
                        >
                          {task.title}
                        </span>
                        <div className="flex flex-shrink-0 items-center space-x-2 text-xs">
                          {task.dependencies.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {task.dependencies.map((dep, idx) => (
                                <span
                                  key={`${task.id}-dep-${idx}`}
                                  className="bg-argo-surfaceAlt text-argo-textSecondary rounded px-1.5 py-0.5 text-[10px] font-medium"
                                >
                                  {dep}
                                </span>
                              ))}
                            </div>
                          )}
                          <span
                            className={cn('rounded px-1.5 py-0.5', statusBadgeClass(task.status))}
                          >
                            {task.status}
                          </span>
                        </div>
                      </button>
                    </div>

                    <AnimatePresence>
                      {isExpanded && task.subtasks.length > 0 && (
                        <motion.div
                          className="relative overflow-hidden"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          layout
                        >
                          <div className="absolute top-0 bottom-0 left-[18px] border-l border-dashed border-argo-border" />
                          <ul className="mt-1 mr-2 mb-1 ml-3 space-y-0.5">
                            {task.subtasks.map((subtask) => {
                              const subtaskKey = `${task.id}-${subtask.id}`;
                              const isSubExpanded = !!expandedSubtasks[subtaskKey];
                              return (
                                <motion.li
                                  key={subtask.id}
                                  className="group flex flex-col py-0.5 pl-6"
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, x: -10 }}
                                  transition={{ duration: 0.15 }}
                                  layout
                                >
                                  <div className="flex flex-1 items-center rounded-md p-1 hover:bg-argo-surfaceAlt/60">
                                    <button
                                      type="button"
                                      className="mr-2 flex-shrink-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleSubtaskStatus?.(task.id, subtask.id);
                                      }}
                                      aria-label="Toggle subtask"
                                    >
                                      {statusIcon(subtask.status, 'sm')}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => toggleSubtaskExpansion(task.id, subtask.id)}
                                      className={cn(
                                        'cursor-pointer text-sm text-left',
                                        subtask.status === 'completed' &&
                                          'line-through text-argo-textSecondary',
                                      )}
                                    >
                                      {subtask.title}
                                    </button>
                                  </div>

                                  <AnimatePresence>
                                    {isSubExpanded && (
                                      <motion.div
                                        className="text-argo-textSecondary border-argo-border mt-1 ml-1.5 border-l border-dashed pl-5 text-xs overflow-hidden"
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ duration: 0.2 }}
                                        layout
                                      >
                                        <p className="py-1">{subtask.description}</p>
                                        {subtask.tools && subtask.tools.length > 0 && (
                                          <div className="mt-0.5 mb-1 flex flex-wrap items-center gap-1.5">
                                            <span className="text-argo-textSecondary font-medium">
                                              Tools:
                                            </span>
                                            <div className="flex flex-wrap gap-1">
                                              {subtask.tools.map((tool, idx) => (
                                                <span
                                                  key={`${subtask.id}-tool-${idx}`}
                                                  className="bg-argo-surfaceAlt text-argo-textSecondary rounded px-1.5 py-0.5 text-[10px] font-medium"
                                                >
                                                  {tool}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </motion.li>
                              );
                            })}
                          </ul>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.li>
                );
              })}
            </ul>
          </div>
        </LayoutGroup>
      </motion.div>
    </div>
  );
}
