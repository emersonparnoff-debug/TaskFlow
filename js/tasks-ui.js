// =========================================================================
// 5. js/tasks-ui.js — Kanban, Lista Simplificada, Subtarefas, Reordenação,
//    Destaque Visual, Senha de Exclusão, Trava de Scroll e Pomodoro
// =========================================================================

async function initApp() {
    loadTheme();
    if (typeof applyLayout === "function") applyLayout();
    if (typeof applySidebarState === "function") applySidebarState();
    initFirebase();
    fetchAllUsersFromCloud();

    try {
        const rawSession = localStorage.getItem(SESSION_KEY);
        if (rawSession) {
            const session = JSON.parse(rawSession);
            if (session && session.user && session.room) {
                currentAuthor = session.user;
                currentUserLogin = session.userLogin || '';
                currentUserRole = session.userRole || (session.isAdmin ? 'admin' : 'member');
                currentUserPermissions = normalizePermissions(session.userPermissions, currentUserRole);
                currentWorkspace = session.room;
                currentRoomPasswordHash = 'open';
                currentRoomAdminHash = 'open';
                isCurrentUserAdmin = Boolean(session.isAdmin || currentUserRole === 'admin');
                isAuthenticated = true;

                updateHeaderSessionUI();
                document.getElementById('roomAuthModal').classList.add('hidden');
                loadTasksFromLocalCache();
                renderAll();
                setupFirestoreRealtimeListener();
                fetchTasksViaRestFallback(false);
                return;
            }
        }
    } catch (e) {}

    // If no active session, open Room Login Modal
    isAuthenticated = false;
    openRoomAuthModal(false);
}

/**************************************************************
 * 7. TASK MANAGEMENT & RENDER ENGINE
 **************************************************************/
function setCategoryFilter(cat) {
    currentCategory = cat;
    document.querySelectorAll('.cat-tab').forEach(btn => {
        btn.className = 'cat-tab px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';
    });
    const activeBtn = document.getElementById(`catTab-${cat}`);
    if (activeBtn) {
        activeBtn.className = 'cat-tab px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition flex items-center gap-1.5 bg-white dark:bg-darkCard text-slate-900 dark:text-white shadow-sm';
    }
    renderAll();
}

function setViewMode(mode) {
    currentView = mode;
    const listBtn = document.getElementById('viewBtn-list');
    const kanbanBtn = document.getElementById('viewBtn-kanban');
    const ganttBtn = document.getElementById('viewBtn-gantt');

    [listBtn, kanbanBtn, ganttBtn].forEach(btn => {
        if (btn) btn.className = 'px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition text-slate-600 dark:text-slate-400';
    });

    const activeBtn = document.getElementById('viewBtn-' + mode);
    if (activeBtn) {
        activeBtn.className = 'px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition bg-white dark:bg-darkCard text-indigo-600 dark:text-indigo-400 shadow-sm';
    }
    renderAll();
}

function handleFiltersChange() {
    renderAll();
}

function renderAll() {
    populateAuthorsDatalist();
    updateDashboardMetrics();
    renderTasksContainer();
}

function updateDashboardMetrics() {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'done').length;
    const todoCount = tasks.filter(t => t.status === 'todo').length;
    const inProgressCount = tasks.filter(t => t.status === 'in_progress').length;
    const todayStr = getLocalDateStr(0);

    const todayPending = tasks.filter(t => t.status !== 'done' && t.dueDate === todayStr).length;
    const overdueCount = tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < todayStr).length;

    let totalSub = 0;
    let doneSub = 0;
    tasks.forEach(t => {
        if (t.subtasks && t.subtasks.length > 0) {
            totalSub += t.subtasks.length;
            doneSub += t.subtasks.filter(s => s.completed).length;
        }
    });

    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statCompletedLabel').textContent = `${completed} concluída${completed === 1 ? '' : 's'}`;
    const todoEl = document.getElementById('statStatusTodo');
    if (todoEl) todoEl.textContent = todoCount;
    const inProgEl = document.getElementById('statStatusInProgress');
    if (inProgEl) inProgEl.textContent = inProgressCount;
    document.getElementById('statToday').textContent = todayPending;
    document.getElementById('statOverdue').textContent = overdueCount;
    document.getElementById('statProgressPercent').textContent = `${percent}%`;
    document.getElementById('statProgressBar').style.width = `${percent}%`;
    document.getElementById('statSubtasksCounter').textContent = `${doneSub}/${totalSub} subtarefas`;
}

function getFilteredTasks() {
    const searchVal = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
    const memberVal = (document.getElementById('memberFilter')?.value || 'all').toLowerCase().trim();
    const priorityVal = document.getElementById('priorityFilter')?.value || 'all';
    const sortVal = document.getElementById('sortBySelect')?.value || 'dueDate';
    const showCompleted = document.getElementById('showCompletedToggle')?.checked ?? true;

    return tasks.filter(t => {
        if (!showCompleted && t.status === 'done') return false;
        if (priorityVal !== 'all' && t.priority !== priorityVal) return false;

        if (memberVal !== 'all') {
            const matchTaskOwner = (t.author || '').toLowerCase().trim() === memberVal;
            const matchSubOwner = (t.subtasks || []).some(s => (s.assignee || '').toLowerCase().trim() === memberVal);
            const matchInnerOwner = (t.subtasks || []).some(s => (s.innerTasks || []).some(it => (it.assignee || '').toLowerCase().trim() === memberVal));
            if (!matchTaskOwner && !matchSubOwner && !matchInnerOwner) return false;
        }

        if (searchVal) {
            const matchTitle = (t.title || '').toLowerCase().includes(searchVal);
            const matchDesc = (t.desc || '').toLowerCase().includes(searchVal);
            const matchAuthor = (t.author || '').toLowerCase().includes(searchVal);
            const matchSub = (t.subtasks || []).some(s =>
                (s.text || '').toLowerCase().includes(searchVal) ||
                (s.assignee || '').toLowerCase().includes(searchVal) ||
                (s.innerTasks || []).some(it => (it.text || '').toLowerCase().includes(searchVal) || (it.assignee || '').toLowerCase().includes(searchVal))
            );
            if (!matchTitle && !matchDesc && !matchAuthor && !matchSub) return false;
        }
        return true;
    }).sort((a, b) => {
        if (sortVal === 'manual') {
            const oA = typeof a.manualOrder === 'number' ? a.manualOrder : tasks.indexOf(a);
            const oB = typeof b.manualOrder === 'number' ? b.manualOrder : tasks.indexOf(b);
            return oA - oB;
        }
        if (sortVal === 'dueDate') {
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return a.dueDate.localeCompare(b.dueDate);
        }
        if (sortVal === 'priority') {
            const wA = PRIORITY_META[a.priority]?.weight || 0;
            const wB = PRIORITY_META[b.priority]?.weight || 0;
            return wB - wA;
        }
        if (sortVal === 'title') {
            return (a.title || '').localeCompare(b.title || '', 'pt-BR');
        }
        return (b.createdAt || 0) - (a.createdAt || 0);
    });
}

function renderTasksContainer() {
    const container = document.getElementById('tasksContainer');
    const filtered = getFilteredTasks();

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="bg-white dark:bg-darkCard rounded-2xl border border-slate-200 dark:border-darkBorder p-12 text-center space-y-4 shadow-sm">
                <div class="w-16 h-16 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center text-2xl mx-auto">
                    <i class="fa-solid fa-clipboard-question"></i>
                </div>
                <div class="space-y-1">
                    <h3 class="text-base font-bold text-slate-800 dark:text-slate-100">Nenhuma tarefa encontrada</h3>
                    <p class="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                        Tente alterar os filtros ou clique no botão abaixo para criar sua primeira tarefa na sala <strong>${currentWorkspace.toUpperCase()}</strong>.
                    </p>
                </div>
                <button onclick="openTaskModal()" class="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition inline-flex items-center gap-2">
                    <i class="fa-solid fa-plus"></i> Criar Nova Tarefa
                </button>
            </div>
        `;
        return;
    }

    if (currentView === 'list') {
        renderSimplifiedListView(filtered, container);
    } else if (currentView === 'gantt') {
        renderGanttView(filtered, container);
    } else {
        renderKanbanView(filtered, container);
    }
}


/**
 * Converte uma data YYYY-MM-DD para o timestamp do final daquele dia (23:59:59.999)
 */

function formatCreatedAtDate(createdAtMs, shortFormat = false) {
    const d = createdAtMs ? new Date(createdAtMs) : new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return shortFormat ? `${day}/${month}` : `${day}/${month}/${year}`;
}

function getTaskDueDateEndMs(dueDateStr) {
    if (!dueDateStr) return null;
    const parts = String(dueDateStr).split('-').map(Number);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    return new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999).getTime();
}

/**
 * Alterna o modo de Execução Simultânea de uma tarefa (intercala subtarefas entre tarefas paralelas)
 */
async function toggleTaskSimultaneous(taskId, event) {
    if (event && event.stopPropagation) event.stopPropagation();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    task.simultaneous = !task.simultaneous;
    task.updatedAt = Date.now();
    saveLocalCacheOnly();
    renderAll();
    await upsertTaskToCloud(task);
    const simCount = tasks.filter(t => t.simultaneous && t.status !== 'done').length;
    showToast(
        task.simultaneous
            ? `Execução Simultânea ativada para "${task.title}" (${simCount} tarefa(s) paralela(s) intercalando subtarefas).`
            : `Execução Simultânea desativada para "${task.title}".`,
        task.simultaneous ? 'success' : 'info'
    );
}

/**
 * Calcula para uma tarefa (ou lista de subtarefas do modal) a previsão de término de cada subtarefa
 * e identifica exatamente quais subtarefas vão exceder o prazo final (dueDate) da tarefa!
 */
function evaluateTaskSubtasksDeadlineInfo(taskOrObj) {
    const result = {
        dueEndMs: null,
        taskExceedsDeadline: false,
        exceedingPendingCount: 0,
        subtaskMap: {} // sIdx -> { startMs, endMs, exceedsDeadline, excessHours, endFormatted }
    };
    if (!taskOrObj) return result;
    const dueEndMs = getTaskDueDateEndMs(taskOrObj.dueDate);
    result.dueEndMs = dueEndMs;

    const settings = getWorkSettings();
    const subs = Array.isArray(taskOrObj.subtasks) ? taskOrObj.subtasks : [];
    const baseStartMs = taskOrObj.createdAt
        ? new Date(taskOrObj.createdAt).setHours(0, 0, 0, 0)
        : new Date().setHours(0, 0, 0, 0);

    // Se a tarefa está marcada como simultânea junto com outras tarefas ativas do mesmo membro,
    // ou isolada, calcula a projeção acumulando as horas úteis
    let cursorMs = baseStartMs;

    // Verifica se há outras tarefas simultâneas ativas para considerar na projeção caso taskOrObj.id exista
    const otherSimTasks = (taskOrObj.id && taskOrObj.simultaneous)
        ? tasks.filter(t => t.id !== taskOrObj.id && t.simultaneous && t.status !== 'done' && doesTaskAppearInRoom(t, currentWorkspace))
        : [];

    if (otherSimTasks.length > 0 && subs.length > 0) {
        // Simula intercalação (Round-Robin) entre as tarefas simultâneas
        const allSimTasks = [taskOrObj, ...otherSimTasks];
        const queues = allSimTasks.map(t => {
            const tSubs = ensureSubtaskStructure(t.subtasks || []);
            const ordered = [
                ...tSubs.map((s, i) => ({ s, i })).filter(x => x.s.completed),
                ...tSubs.map((s, i) => ({ s, i })).filter(x => !x.s.completed)
            ];
            return { taskId: t.id, items: ordered, ptr: 0 };
        });

        let hasMore = true;
        while (hasMore) {
            hasMore = false;
            for (const q of queues) {
                if (q.ptr < q.items.length) {
                    hasMore = true;
                    const { s, i } = q.items[q.ptr++];
                    const h = Math.max(0.1, Number(s.hours) || 2);
                    const alloc = allocateWorkingHoursOnTimeline(cursorMs, h, settings);
                    cursorMs = alloc.nextCursorMs;

                    if (q.taskId === taskOrObj.id) {
                        const exceeds = Boolean(dueEndMs && alloc.endMs > dueEndMs && !s.completed);
                        const excessHours = (dueEndMs && alloc.endMs > dueEndMs)
                            ? Math.max(0.1, Math.round(((alloc.endMs - dueEndMs) / (1000 * 60 * 60 * 24)) * DAILY_WORK_HOURS * 10) / 10)
                            : 0;
                        if (exceeds) {
                            result.taskExceedsDeadline = true;
                            result.exceedingPendingCount++;
                        }
                        result.subtaskMap[i] = {
                            startMs: alloc.startMs,
                            endMs: alloc.endMs,
                            exceedsDeadline: exceeds,
                            excessHours,
                            endFormatted: new Date(alloc.endMs - 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                        };
                    }
                }
            }
        }
        return result;
    }

    // Cálculo sequencial padrão das subtarefas da tarefa
    subs.forEach((s, idx) => {
        const h = Math.max(0.1, Number(s.hours) || 2);
        const alloc = allocateWorkingHoursOnTimeline(cursorMs, h, settings);
        cursorMs = alloc.nextCursorMs;

        const exceeds = Boolean(dueEndMs && alloc.endMs > dueEndMs && !s.completed);
        const excessHours = (dueEndMs && alloc.endMs > dueEndMs)
            ? Math.max(0.1, Math.round(((alloc.endMs - dueEndMs) / (1000 * 60 * 60 * 24)) * DAILY_WORK_HOURS * 10) / 10)
            : 0;

        if (exceeds) {
            result.taskExceedsDeadline = true;
            result.exceedingPendingCount++;
        }

        result.subtaskMap[idx] = {
            startMs: alloc.startMs,
            endMs: alloc.endMs,
            exceedsDeadline: exceeds,
            excessHours,
            endFormatted: new Date(alloc.endMs - 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        };
    });

    return result;
}

function renderTaskCardHTML(task) {
    const cat = { borderClass: 'border-l-4 border-l-indigo-500' };
    const pri = PRIORITY_META[task.priority] || PRIORITY_META.media;
    const status = STATUS_META[task.status] || STATUS_META.todo;
    const dueStatus = getDueDateStatus(task.dueDate, task.status);

    let dueBadgeClass = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700';
    let dueIcon = 'fa-regular fa-calendar';
    if (dueStatus === 'overdue') {
        dueBadgeClass = 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 animate-pulse';
        dueIcon = 'fa-solid fa-triangle-exclamation';
    } else if (dueStatus === 'today') {
        dueBadgeClass = 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
        dueIcon = 'fa-solid fa-clock';
    }

    const subtasks = ensureSubtaskStructure(task.subtasks || []);
    const subDoneCount = subtasks.filter(s => s.completed).length;
    const subPercent = subtasks.length > 0 ? Math.round((subDoneCount / subtasks.length) * 100) : 0;
    const rawTotalTaskHours = subtasks.length > 0
        ? subtasks.reduce((acc, s) => acc + (Number(s.hours) || 2), 0)
        : (Number(task.estimatedHours) || 8);
    const rawDoneTaskHours = subtasks.length > 0
        ? subtasks.filter(s => s.completed).reduce((acc, s) => acc + (Number(s.hours) || 2), 0)
        : (task.status === 'done' ? rawTotalTaskHours : 0);
    const totalTaskHours = formatTotalHours1Dec(rawTotalTaskHours);
    const doneTaskHours = formatTotalHours1Dec(rawDoneTaskHours);
    const totalTaskDays = (rawTotalTaskHours / 8).toFixed(1);
    const deadlineEval = evaluateTaskSubtasksDeadlineInfo(task);

    const allowStatus = hasUserPermission('canChangeStatus');
    const allowSubtasks = hasUserPermission('canManageSubtasks');
    const allowEdit = hasUserPermission('canEdit');
    const allowDelete = hasUserPermission('canDelete');

    const isCardExpanded = expandedTaskCardsSet.has(task.id);
    const isHighlighted = activeHighlightedTaskId === task.id;
    const isTaskOwner = doesAssigneeMatchUser(task.author, currentAuthor, currentUserLogin);
    const canReassignAnySubtask = isCurrentUserAdmin || isTaskOwner;

    const highlightClasses = isHighlighted
        ? 'ring-2 ring-indigo-500 dark:ring-indigo-400 border-indigo-500 dark:border-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/30 shadow-lg shadow-indigo-500/15 scale-[1.01] z-10'
        : 'bg-white dark:bg-darkCard border-slate-200 dark:border-darkBorder shadow-sm hover:shadow-md';

    return `
        <div data-task-card-id="${task.id}" onclick="setActiveHighlightedTask('${task.id}', event)" class="rounded-2xl border transition-all duration-200 flex flex-col justify-between overflow-hidden ${highlightClasses} ${cat.borderClass} ${task.status === 'done' && !isHighlighted ? 'opacity-70' : ''}" draggable="true" ondragstart="handleDragStart(event, '${task.id}')" ondragover="handleCardDragOver(event)" ondragleave="handleCardDragLeave(event)" ondrop="handleCardDropReorder(event, '${task.id}')">
            
            <!-- CABEÇALHO DA TAREFA (Sempre visível • Clique para expandir/recolher) -->
            <div onclick="handleTaskHeaderClick(event, '${task.id}')" class="p-4 cursor-pointer select-none hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition space-y-2.5">
                <!-- Linha Superior: Reordenação, Prioridade, Prazo, Status e Botão Expandir/Recolher -->
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <!-- Botões de Reordenação da Tarefa -->
                        <div class="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-0.5" onclick="event.stopPropagation()" title="Reordenar posição da tarefa (ou arraste o cartão)">
                            <button type="button" onclick="moveTaskOrder('${task.id}', -1)" class="w-5 h-5 rounded hover:bg-white dark:hover:bg-slate-700 text-slate-500 hover:text-indigo-600 flex items-center justify-center transition" title="Mover tarefa para cima / anterior">
                                <i class="fa-solid fa-chevron-up text-[9px]"></i>
                            </button>
                            <button type="button" onclick="moveTaskOrder('${task.id}', 1)" class="w-5 h-5 rounded hover:bg-white dark:hover:bg-slate-700 text-slate-500 hover:text-indigo-600 flex items-center justify-center transition" title="Mover tarefa para baixo / próxima">
                                <i class="fa-solid fa-chevron-down text-[9px]"></i>
                            </button>
                        </div>
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${pri.badgeClass}">
                            <i class="fa-solid ${pri.icon}"></i> ${pri.label}
                        </span>
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-medium" title="Data de criação da tarefa principal: ${formatCreatedAtDate(task.createdAt, false)}">
                            <i class="fa-solid fa-calendar-plus text-indigo-500 text-[9px]"></i> Criada: ${formatCreatedAtDate(task.createdAt, false)}
                        </span>
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-medium ${dueBadgeClass}" title="Data de vencimento (Prazo Final): ${formatDisplayDate(task.dueDate)}">
                            <i class="fa-solid ${dueIcon}"></i> Venc: ${formatDisplayDate(task.dueDate)}
                        </span>
                        ${subtasks.length > 0 ? `
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${subDoneCount === subtasks.length ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20'}" title="Progresso das Subtarefas">
                                <i class="fa-solid fa-boxes-stacked text-[9px]"></i> ${subDoneCount}/${subtasks.length} (${subPercent}%)
                            </span>
                        ` : ''}
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25" title="Carga horária estimada: ${doneTaskHours}h concluídas de ${totalTaskHours}h (${totalTaskDays} dias úteis de 8h)">
                            <i class="fa-regular fa-clock text-[9px]"></i> ${totalTaskHours}h (${totalTaskDays}d)
                        </span>
                        <button type="button" onclick="toggleTaskSimultaneous('${task.id}', event)" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border transition cursor-pointer ${
                            task.simultaneous
                                ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/40 shadow-sm'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-cyan-500/40 hover:text-cyan-600'
                        }" title="${task.simultaneous ? 'Execução Simultânea ATIVA: subtarefas intercaladas com outras tarefas simultâneas. Clique para desativar.' : 'Clique para ativar Execução Simultânea (distribuir/intercalar subtarefas com outra tarefa)'}">
                            <i class="fa-solid fa-code-branch text-[9px]"></i> ${task.simultaneous ? 'Simultânea' : 'Sequencial'}
                        </button>
                        ${deadlineEval.exceedingPendingCount > 0 ? `
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/35 animate-pulse" title="${deadlineEval.exceedingPendingCount} subtarefa(s) vão exceder o prazo final (${formatDisplayDate(task.dueDate)})!">
                                <i class="fa-solid fa-bell-exclamation text-[9px]"></i> ${deadlineEval.exceedingPendingCount} excede(m) prazo!
                            </span>
                        ` : ''}
                        ${isHighlighted ? `
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white shadow-sm">
                                <i class="fa-solid fa-star text-[8px]"></i> Em Destaque
                            </span>
                        ` : ''}
                    </div>

                    <div class="flex items-center gap-1.5 shrink-0" onclick="event.stopPropagation()">
                        <select onchange="updateTaskStatus('${task.id}', this.value)" ${allowStatus ? '' : 'disabled title="Sem permissão para alterar status"'} class="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none ${allowStatus ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}">
                            <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>📋 A Fazer</option>
                            <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>⏳ Em And.</option>
                            <option value="done" ${task.status === 'done' ? 'selected' : ''}>✅ Concluído</option>
                        </select>
                        <button type="button" onclick="toggleTaskCardCollapse('${task.id}')" class="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-500/15 text-slate-500 dark:text-slate-300 hover:text-indigo-600 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition" title="${isCardExpanded ? 'Recolher tarefa ao cabeçalho' : 'Expandir detalhes e subtarefas'}">
                            <i class="fa-solid ${isCardExpanded ? 'fa-chevron-up' : 'fa-chevron-down'} text-xs"></i>
                        </button>
                    </div>
                </div>

                <!-- Linha do Título do Pedido/Tarefa + Resumo Rápido do Responsável -->
                <div class="flex items-start justify-between gap-2">
                    <h4 class="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 leading-snug ${task.status === 'done' ? 'line-through text-slate-400 dark:text-slate-500' : ''}">
                        ${escapeHtml(task.title)}
                    </h4>
                </div>

                <!-- Barra compacta de Responsável + Progresso no Cabeçalho -->
                <div class="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                    <div class="flex items-center gap-1.5 truncate">
                        <i class="fa-solid fa-user-check text-indigo-500 text-[10px]"></i>
                        <span class="font-medium truncate">${task.author ? escapeHtml(task.author) : 'Sem responsável definido'}</span>
                    </div>
                    <span class="text-[10px] text-indigo-500 dark:text-indigo-400 font-semibold shrink-0 flex items-center gap-1">
                        ${isCardExpanded ? '<i class="fa-solid fa-eye-slash text-[9px]"></i> Recolher' : `<i class="fa-solid fa-eye text-[9px]"></i> Ver detalhes (${subtasks.length} itens)`}
                    </span>
                </div>

                ${subtasks.length > 0 ? `
                    <div class="w-full bg-slate-100 dark:bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div class="bg-gradient-to-r from-indigo-500 to-emerald-500 h-full rounded-full transition-all duration-300" style="width: ${subPercent}%"></div>
                    </div>
                ` : ''}
            </div>

            <!-- CORPO EXPANSÍVEL DA TAREFA (Oculto por padrão • Exibido apenas quando expandido) -->
            <div class="${isCardExpanded ? 'block' : 'hidden'} border-t border-slate-100 dark:border-slate-800/80">
                <div class="p-4 pt-3 space-y-3">
                    ${task.desc ? `<p class="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-line">${escapeHtml(task.desc)}</p>` : ''}

                    <!-- Subtarefas com reordenação, atribuição de membro (lista ao clicar) e Tarefas Internas ocultas por padrão -->
                    ${subtasks.length > 0 ? `
                        <div class="space-y-2">
                            <div class="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                                <span><i class="fa-solid fa-boxes-stacked mr-1 text-indigo-500"></i>Subtarefas (${subDoneCount}/${subtasks.length}) • <strong class="text-amber-600 dark:text-amber-400">${totalTaskHours}h (${totalTaskDays}d)</strong></span>
                                <div class="flex items-center gap-1.5">
                                    ${allowEdit ? `
                                        <button type="button" onclick="distributeCardSubtaskHours('${task.id}')" class="px-1.5 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/25 text-[10px] font-bold transition flex items-center gap-1" title="Redistribuir horas entre as subtarefas considerando 8h diárias até o vencimento">
                                            <i class="fa-solid fa-wand-magic-sparkles text-[8px]"></i> 8h/dia
                                        </button>
                                    ` : ''}
                                    <span>${subPercent}%</span>
                                </div>
                            </div>
                            <div data-scroll-id="sublist_${task.id}" onscroll="recordContainerScroll(this)" class="space-y-2 max-h-72 overflow-y-auto pr-1 pt-0.5">
                                ${subtasks.map((sub, sIdx) => {
                                    const innerList = Array.isArray(sub.innerTasks) ? sub.innerTasks : [];
                                    const hasInner = innerList.length > 0;
                                    const innerDone = innerList.filter(it => it.completed).length;
                                    const cardSubKey = `${task.id}::${sIdx}`;
                                    const isInnerVisible = expandedCardSubtasksSet.has(cardSubKey);

                                    const isAssignedToMe = doesAssigneeMatchUser(sub.assignee, currentAuthor, currentUserLogin);
                                    const isAssignedToOther = Boolean(sub.assignee) && !isAssignedToMe;
                                    const canChangeThisSubAssignee = canReassignAnySubtask || isAssignedToMe || !sub.assignee;
                                    const subDeadlineInfo = deadlineEval.subtaskMap[sIdx] || {};
                                    const subExceeds = Boolean(subDeadlineInfo.exceedsDeadline && !sub.completed);

                                    return `
                                        <div class="rounded-xl border ${subExceeds ? 'border-rose-500/60 bg-rose-500/10 dark:bg-rose-950/25 ring-1 ring-rose-500/30' : (isAssignedToMe ? 'border-indigo-500/40 bg-indigo-500/5 dark:bg-indigo-500/10' : 'border-slate-200/80 dark:border-slate-700/70 bg-slate-50/70 dark:bg-slate-800/40')} p-2 space-y-1.5 transition">
                                            <!-- Cabeçalho da Subtarefa (Item) + Botões de Reordenação -->
                                            <div class="flex items-start justify-between gap-2 text-xs">
                                                <div class="flex items-start gap-1.5 min-w-0 flex-1">
                                                    <!-- Reordenar Subtarefa -->
                                                    <div class="inline-flex flex-col rounded bg-slate-200/60 dark:bg-slate-700/60 p-0.5 shrink-0 mt-0.5" title="Reordenar subtarefa">
                                                        <button type="button" onclick="moveCardSubtaskOrder('${task.id}', ${sIdx}, -1)" ${sIdx === 0 ? 'disabled' : ''} class="w-4 h-3.5 rounded hover:bg-white dark:hover:bg-slate-600 disabled:opacity-30 text-slate-600 dark:text-slate-300 flex items-center justify-center transition" title="Subir subtarefa">
                                                            <i class="fa-solid fa-caret-up text-[9px]"></i>
                                                        </button>
                                                        <button type="button" onclick="moveCardSubtaskOrder('${task.id}', ${sIdx}, 1)" ${sIdx === subtasks.length - 1 ? 'disabled' : ''} class="w-4 h-3.5 rounded hover:bg-white dark:hover:bg-slate-600 disabled:opacity-30 text-slate-600 dark:text-slate-300 flex items-center justify-center transition" title="Descer subtarefa">
                                                            <i class="fa-solid fa-caret-down text-[9px]"></i>
                                                        </button>
                                                    </div>
                                                    <label class="flex items-start gap-2 min-w-0 flex-1 ${allowSubtasks ? 'cursor-pointer' : 'cursor-default'}">
                                                        <input type="checkbox" ${sub.completed ? 'checked' : ''} ${allowSubtasks ? '' : 'disabled'} onchange="toggleSubtaskStatus('${task.id}', ${sIdx})" class="mt-0.5 rounded text-indigo-600 w-3.5 h-3.5 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 shrink-0 cursor-pointer">
                                                        <span class="font-semibold text-slate-700 dark:text-slate-200 leading-snug break-words ${sub.completed ? 'line-through opacity-55' : ''}">${escapeHtml(sub.text)}</span>
                                                    </label>
                                                </div>
                                                <div class="flex items-center gap-1 shrink-0">
                                                    ${hasInner ? `
                                                        <button type="button" onclick="toggleCardSubtaskInnerVisibility('${task.id}', ${sIdx})" class="px-2 py-0.5 rounded-lg text-[10px] font-bold border transition flex items-center gap-1 cursor-pointer ${
                                                            isInnerVisible
                                                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                                                : (innerDone === innerList.length
                                                                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                                                                    : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/25 hover:bg-indigo-500/20')
                                                        }" title="${isInnerVisible ? 'Ocultar tarefas internas' : 'Mostrar tarefas internas atribuídas (' + innerDone + '/' + innerList.length + ')'}">
                                                            <i class="fa-solid ${isInnerVisible ? 'fa-eye-slash' : 'fa-list-check'} text-[9px]"></i>
                                                            <span>${innerDone}/${innerList.length}</span>
                                                            <i class="fa-solid ${isInnerVisible ? 'fa-chevron-up' : 'fa-chevron-down'} text-[8px]"></i>
                                                        </button>
                                                    ` : ''}
                                                    ${allowEdit ? `
                                                        <button type="button" onclick="openTaskModalAndFocusSubtask('${task.id}', ${sIdx})" class="px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-700/70 hover:bg-indigo-500/20 text-slate-600 dark:text-slate-300 hover:text-indigo-500 text-[10px] font-semibold transition" title="Configurar etapas internas e dependências desta subtarefa">
                                                            <i class="fa-solid fa-diagram-project"></i>
                                                        </button>
                                                    ` : ''}
                                                </div>
                                            </div>

                                            <!-- Linha de Atribuição de Membro + Ajuste de Horas na Subtarefa -->
                                            <div class="flex flex-wrap items-center justify-between gap-1.5 pl-6 pt-0.5">
                                                <div class="flex items-center gap-1.5 min-w-0 flex-1">
                                                    <i class="fa-solid fa-user-tag text-[10px] ${sub.assignee ? 'text-indigo-500' : 'text-slate-400'}"></i>
                                                    ${canChangeThisSubAssignee ? `
                                                        <select onchange="updateCardSubtaskAssignee('${task.id}', ${sIdx}, this.value)" class="w-full max-w-[165px] px-2 py-0.5 rounded-md bg-white/90 dark:bg-slate-900/70 border border-slate-200/90 dark:border-slate-700/90 text-[11px] font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer transition">
                                                            ${buildMemberSelectOptionsHTML(sub.assignee || '', canReassignAnySubtask || isAssignedToMe, '👤 Atribuir membro...')}
                                                        </select>
                                                    ` : `
                                                        <span class="text-[11px] font-medium text-slate-500 dark:text-slate-400" title="Apenas o Administrador ou o responsável pode alterar esta subtarefa">
                                                            <i class="fa-solid fa-lock text-[9px] mr-0.5"></i> ${escapeHtml(sub.assignee)}
                                                        </span>
                                                    `}
                                                </div>

                                                ${subExceeds ? `
                                                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-600 text-white text-[9px] font-extrabold shadow-sm shrink-0" title="Atenção: Esta subtarefa terminará em ${subDeadlineInfo.endFormatted}, excedendo o prazo final da tarefa (${formatDisplayDate(task.dueDate)}) em +${subDeadlineInfo.excessHours}h!">
                                                        <i class="fa-solid fa-triangle-exclamation text-[8px]"></i> Excede prazo (${subDeadlineInfo.endFormatted})
                                                    </span>
                                                ` : (subDeadlineInfo.endFormatted && !sub.completed ? `
                                                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[9px] font-semibold shrink-0" title="Previsão de conclusão desta subtarefa dentro do prazo: ${subDeadlineInfo.endFormatted}">
                                                        <i class="fa-regular fa-calendar-check text-[8px]"></i> Prev: ${subDeadlineInfo.endFormatted}
                                                    </span>
                                                ` : '')}
                                                <!-- Controle Rápido de Horas da Subtarefa -->
                                                <div class="inline-flex items-center rounded-md ${subExceeds ? 'bg-rose-500/15 border-rose-500/40' : 'bg-amber-500/10 border-amber-500/25'} border px-1 py-0.2 gap-0.5 shrink-0" onclick="event.stopPropagation()" title="Tempo estimado desta subtarefa em horas (8h = 1 dia útil)">
                                                    <button type="button" onclick="adjustCardSubtaskHours('${task.id}', ${sIdx}, -0.5)" ${allowEdit || canChangeThisSubAssignee ? '' : 'disabled'} class="w-3.5 h-3.5 rounded hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-[10px] disabled:opacity-40">-</button>
                                                    <input type="number" min="0.1" step="0.1" value="${Number(sub.hours || 2)}" ${allowEdit || canChangeThisSubAssignee ? '' : 'disabled'} onchange="updateCardSubtaskHours('${task.id}', ${sIdx}, this.value)" class="w-9 bg-transparent text-center font-mono font-bold text-[10px] text-amber-700 dark:text-amber-300 focus:outline-none">
                                                    <span class="text-[9px] font-bold text-amber-600 dark:text-amber-400">h</span>
                                                    <button type="button" onclick="adjustCardSubtaskHours('${task.id}', ${sIdx}, 0.5)" ${allowEdit || canChangeThisSubAssignee ? '' : 'disabled'} class="w-3.5 h-3.5 rounded hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-[10px] disabled:opacity-40">+</button>
                                                </div>
                                                ${hasInner && !isInnerVisible ? `
                                                    <button type="button" onclick="toggleCardSubtaskInnerVisibility('${task.id}', ${sIdx})" class="text-[10px] text-indigo-500 hover:underline font-medium shrink-0">
                                                        Ver ${innerList.length} etapa(s)
                                                    </button>
                                                ` : ''}
                                            </div>

                                            <!-- Lista de Tarefas Internas da Subtarefa (Oculta por padrão, exibida apenas quando pedido) -->
                                            ${hasInner && isInnerVisible ? `
                                                <div class="pl-3 border-l-2 border-indigo-500/30 space-y-1 pt-1.5 mt-1">
                                                    <div class="flex items-center justify-between text-[10px] text-slate-400 px-1 pb-0.5">
                                                        <span class="font-semibold uppercase tracking-wider">Tarefas Internas da Subtarefa</span>
                                                        <button type="button" onclick="toggleCardSubtaskInnerVisibility('${task.id}', ${sIdx})" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                                                            Ocultar <i class="fa-solid fa-xmark ml-0.5"></i>
                                                        </button>
                                                    </div>
                                                    ${innerList.map((inTask, iIdx) => {
                                                        const depInfo = getInnerTaskBlockInfo(innerList, iIdx);
                                                        const isLocked = depInfo.isBlocked && !inTask.completed;
                                                        const canToggleInner = allowSubtasks && !isLocked;

                                                        return `
                                                            <div onclick="handleInnerTaskCardClick(event, '${task.id}', ${sIdx}, ${iIdx})" class="flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg text-[11px] border transition ${
                                                                isLocked
                                                                    ? 'bg-amber-500/5 dark:bg-amber-950/20 border-amber-500/25 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                                                                    : 'bg-white/80 dark:bg-slate-900/50 border-slate-200/70 dark:border-slate-700/60 text-slate-700 dark:text-slate-200 ' + (canToggleInner ? 'cursor-pointer hover:border-indigo-500/40' : 'opacity-75')
                                                            }">
                                                                <div class="flex items-center gap-1.5 min-w-0 flex-1">
                                                                    ${isLocked ? `
                                                                        <span class="w-3.5 h-3.5 flex items-center justify-center text-amber-500 shrink-0" title="Bloqueada: conclua a etapa #${depInfo.depIndex + 1} (${escapeHtml(depInfo.depText)}) primeiro">
                                                                            <i class="fa-solid fa-lock text-[9px]"></i>
                                                                        </span>
                                                                    ` : `
                                                                        <input type="checkbox" ${inTask.completed ? 'checked' : ''} ${canToggleInner ? '' : 'disabled'} onchange="toggleInnerTaskStatus('${task.id}', ${sIdx}, ${iIdx})" onclick="event.stopPropagation()" class="rounded text-emerald-600 w-3 h-3 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 shrink-0 cursor-pointer">
                                                                    `}
                                                                    <span class="px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-[9px] font-mono font-bold text-slate-500 shrink-0">#${iIdx + 1}</span>
                                                                    <span class="truncate ${inTask.completed ? 'line-through opacity-55' : ''}" title="${escapeHtml(inTask.text)}">${escapeHtml(inTask.text)}</span>
                                                                </div>

                                                                <div class="flex items-center gap-1 shrink-0">
                                                                    ${inTask.assignee ? `
                                                                        <span class="px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 text-[9px] font-semibold truncate max-w-[75px]" title="Atribuído a: ${escapeHtml(inTask.assignee)}">
                                                                            <i class="fa-solid fa-user text-[8px] mr-0.5"></i>${escapeHtml(inTask.assignee)}
                                                                        </span>
                                                                    ` : ''}
                                                                    ${depInfo.hasDependency ? `
                                                                        <span class="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                                                                            depInfo.isBlocked
                                                                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                                                                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                                                        }" title="${depInfo.isBlocked ? 'Depende da etapa #' + (depInfo.depIndex + 1) + ': ' + escapeHtml(depInfo.depText) : 'Pré-requisito #' + (depInfo.depIndex + 1) + ' concluído'}">
                                                                            <i class="fa-solid ${depInfo.isBlocked ? 'fa-hourglass-half' : 'fa-link'} text-[8px]"></i>#${depInfo.depIndex + 1}
                                                                        </span>
                                                                    ` : ''}
                                                                </div>
                                                            </div>
                                                        `;
                                                    }).join('')}
                                                </div>
                                            ` : ''}
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    ` : `<p class="text-xs text-slate-400 italic">Nenhuma subtarefa cadastrada neste pedido.</p>`}
                </div>

                <!-- Rodapé da Tarefa Expandida: Atribuição do Responsável Principal (Dropdown ao clicar) & Ações -->
                <div class="px-4 py-2.5 bg-slate-50/70 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                    <div class="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400" title="Responsável Principal pela Tarefa / Pedido">
                        <i class="fa-solid fa-user-shield text-indigo-500"></i>
                        <span class="text-[10px] uppercase font-bold text-slate-400">Resp. Tarefa:</span>
                        ${isCurrentUserAdmin ? `
                            <select onchange="updateCardTaskAssignee('${task.id}', this.value)" class="w-36 sm:w-44 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer transition">
                                ${buildMemberSelectOptionsHTML(task.author || '', true, '👤 Sem responsável')}
                            </select>
                        ` : `
                            <span class="font-semibold text-slate-700 dark:text-slate-200">${escapeHtml(task.author || 'Sem responsável')}</span>
                        `}
                    </div>

                    <div class="flex items-center gap-1">
                        ${allowEdit ? `
                            <button type="button" onclick="openTaskModal('${task.id}')" class="px-2 py-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-indigo-600 transition flex items-center gap-1 text-[11px] font-medium" title="Editar Tarefa">
                                <i class="fa-solid fa-pen text-[10px]"></i> Editar
                            </button>
                        ` : `
                            <span class="p-1.5 text-slate-300 dark:text-slate-700 cursor-not-allowed" title="Sem permissão para editar"><i class="fa-solid fa-lock text-[11px]"></i></span>
                        `}
                        ${allowDelete ? `
                            <button type="button" onclick="deleteTask('${task.id}')" class="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-500 hover:text-rose-600 transition" title="Excluir Tarefa">
                                <i class="fa-solid fa-trash text-xs"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderKanbanView(filteredTasks, containerEl) {
    const todoList = filteredTasks.filter(t => t.status === 'todo');
    const inProgressList = filteredTasks.filter(t => t.status === 'in_progress');
    const doneList = filteredTasks.filter(t => t.status === 'done');

    containerEl.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            <!-- Column 1: A Fazer -->
            <div class="bg-slate-100/80 dark:bg-slate-900/40 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 space-y-3" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, 'todo')">
                <div class="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                    <h3 class="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-2">
                        <i class="fa-regular fa-circle text-slate-400"></i> A Fazer
                    </h3>
                    <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">${todoList.length}</span>
                </div>
                <div class="space-y-3 min-h-[300px]">
                    ${todoList.length === 0 ? `<p class="text-xs text-center text-slate-400 py-8">Nenhuma tarefa</p>` : todoList.map(renderTaskCardHTML).join('')}
                </div>
            </div>

            <!-- Column 2: Em Andamento -->
            <div class="bg-slate-100/80 dark:bg-slate-900/40 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 space-y-3" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, 'in_progress')">
                <div class="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                    <h3 class="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                        <i class="fa-solid fa-spinner text-indigo-500"></i> Em Andamento
                    </h3>
                    <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">${inProgressList.length}</span>
                </div>
                <div class="space-y-3 min-h-[300px]">
                    ${inProgressList.length === 0 ? `<p class="text-xs text-center text-slate-400 py-8">Nenhuma tarefa</p>` : inProgressList.map(renderTaskCardHTML).join('')}
                </div>
            </div>

            <!-- Column 3: Concluído -->
            <div class="bg-slate-100/80 dark:bg-slate-900/40 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 space-y-3" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, 'done')">
                <div class="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                    <h3 class="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                        <i class="fa-solid fa-circle-check text-emerald-500"></i> Concluído
                    </h3>
                    <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">${doneList.length}</span>
                </div>
                <div class="space-y-3 min-h-[300px]">
                    ${doneList.length === 0 ? `<p class="text-xs text-center text-slate-400 py-8">Nenhuma tarefa</p>` : doneList.map(renderTaskCardHTML).join('')}
                </div>
            </div>
        </div>
    `;
}

// Drag and Drop handlers
function handleDragStart(e, taskId) {
    if (!hasUserPermission('canChangeStatus')) {
        e.preventDefault();
        showToast('Você não tem permissão para mover tarefas no Kanban.', 'error');
        return;
    }
    draggedTaskId = taskId;
    e.dataTransfer.setData('text/plain', taskId);
}

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function handleDrop(e, newStatus) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const taskId = draggedTaskId || e.dataTransfer.getData('text/plain');
    if (taskId) {
        updateTaskStatus(taskId, newStatus);
    }
}

/**************************************************************
 * 8. TASK ACTIONS & MODAL BUILDERS
 **************************************************************/
function openTaskModal(taskId = null) {
    if (taskId && !hasUserPermission('canEdit')) {
        showToast('Você não possui permissão para editar tarefas.', 'error');
        return;
    }
    if (!taskId && !hasUserPermission('canCreate')) {
        showToast('Você não possui permissão para criar novas tarefas.', 'error');
        return;
    }

    const modal = document.getElementById('taskModal');
    const form = document.getElementById('taskForm');
    form.reset();
    modalSubtasks = [];

    if (taskId) {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;
        document.getElementById('modalTitle').innerHTML = `<i class="fa-solid fa-pen-to-square text-indigo-500"></i><span>Editar Tarefa</span>`;
        document.getElementById('taskIdInput').value = task.id;
        document.getElementById('taskTitleInput').value = task.title || '';
        document.getElementById('taskAuthorInput').value = task.author || currentAuthor || '';
        document.getElementById('taskDescInput').value = task.desc || '';
        
        document.getElementById('taskPriorityInput').value = task.priority || 'media';
        document.getElementById('taskDueDateInput').value = task.dueDate || getLocalDateStr(0);
        document.getElementById('taskStatusInput').value = task.status || 'todo';
        const simCheck = document.getElementById('taskSimultaneousInput');
        if (simCheck) simCheck.checked = Boolean(task.simultaneous);
        modalSubtasks = JSON.parse(JSON.stringify(task.subtasks || []));
        const macroInp = document.getElementById('taskMacroHoursInput');
        if (macroInp) {
            const subHoursSum = modalSubtasks.reduce((acc, s) => acc + (Number(s.hours) || 2), 0);
            macroInp.value = task.macroTotalHours || task.estimatedHours || (subHoursSum > 0 ? subHoursSum : '');
        }
    } else {
        document.getElementById('modalTitle').innerHTML = `<i class="fa-solid fa-plus text-indigo-500"></i><span>Nova Tarefa</span>`;
        document.getElementById('taskIdInput').value = '';
        document.getElementById('taskAuthorInput').value = currentAuthor || '';
        document.getElementById('taskDueDateInput').value = getLocalDateStr(0);
        
        document.getElementById('taskStatusInput').value = 'todo';
        const simCheck = document.getElementById('taskSimultaneousInput');
        if (simCheck) simCheck.checked = false;
        const macroInp = document.getElementById('taskMacroHoursInput');
        if (macroInp) macroInp.value = '';
    }

    activeExpandedSubtaskIdx = -1;
    const subAssInp = document.getElementById('newSubtaskAssigneeInput');
    if (subAssInp) subAssInp.value = document.getElementById('taskAuthorInput').value || currentAuthor || '';
    renderModalSubtasks();
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('taskTitleInput')?.focus(), 50);
}

function closeTaskModal() {
    document.getElementById('taskModal').classList.add('hidden');
}

let activeExpandedSubtaskIdx = -1;
const expandedCardSubtasksSet = new Set();

function toggleCardSubtaskInnerVisibility(taskId, subIdx) {
    const key = `${taskId}::${subIdx}`;
    if (expandedCardSubtasksSet.has(key)) {
        expandedCardSubtasksSet.delete(key);
    } else {
        expandedCardSubtasksSet.add(key);
    }
    renderAll();
}

async function updateCardTaskAssignee(taskId, newAssignee) {
    if (!hasUserPermission('canEdit')) {
        showToast('Você não possui permissão para atribuir tarefas.', 'error');
        renderAll();
        return;
    }
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    task.author = (newAssignee || '').trim();
    task.updatedAt = Date.now();
    renderAll();
    await upsertTaskToCloud(task);
    showToast(task.author ? `Tarefa atribuída a "${task.author}".` : 'Responsável da tarefa removido.', 'success');
}

async function updateCardSubtaskAssignee(taskId, subIdx, newAssignee) {
    if (!hasUserPermission('canEdit')) {
        showToast('Você não possui permissão para atribuir subtarefas.', 'error');
        renderAll();
        return;
    }
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.subtasks || !task.subtasks[subIdx]) return;
    ensureSubtaskStructure(task.subtasks);
    task.subtasks[subIdx].assignee = (newAssignee || '').trim();
    task.updatedAt = Date.now();
    renderAll();
    await upsertTaskToCloud(task);
    showToast(
        task.subtasks[subIdx].assignee
            ? `Subtarefa #${subIdx + 1} atribuída a "${task.subtasks[subIdx].assignee}".`
            : `Membro removido da subtarefa #${subIdx + 1}.`,
        'success'
    );
}

function ensureSubtaskStructure(subtasksList) {
    if (!Array.isArray(subtasksList)) return [];
    subtasksList.forEach((s, idx) => {
        if (!s.id) {
            s.id = 'sub_' + idx + '_' + Math.random().toString(36).substring(2, 8);
        }
        if (typeof s.originalOrder !== 'number') {
            s.originalOrder = idx;
        }
        if (s.assignee === undefined) {
            s.assignee = '';
        }
        if (s.hours === undefined || isNaN(Number(s.hours)) || Number(s.hours) <= 0) {
            s.hours = 2; // Padrão: 2h por subtarefa (4 subtarefas = 1 dia útil de 8h)
        } else {
            s.hours = Math.max(0.1, Number(s.hours));
        }
        if (!Array.isArray(s.innerTasks)) {
            s.innerTasks = [];
        }
        s.innerTasks.forEach((it, iIdx) => {
            if (!it.id) {
                it.id = 'in_' + idx + '_' + iIdx + '_' + Math.random().toString(36).substring(2, 7);
            }
            if (it.dependsOn === undefined) it.dependsOn = null;
            if (it.assignee === undefined) it.assignee = s.assignee || '';
            if (it.hours === undefined || isNaN(Number(it.hours)) || Number(it.hours) <= 0) {
                it.hours = Math.max(0.1, Math.round((s.hours / Math.max(1, s.innerTasks.length)) * 10) / 10);
            }
            if (it.completed === undefined) it.completed = false;
        });
    });
    return subtasksList;
}

/**
 * Agrupa todas as subtarefas concluídas (inclusive por antecipação) em ordem no topo,
 * cedendo o seu espaço e antecipando no cronograma as demais subtarefas pendentes!
 */
function groupCompletedSubtasksAtTop(task) {
    if (!task || !Array.isArray(task.subtasks) || task.subtasks.length <= 1) return;
    ensureSubtaskStructure(task.subtasks);

    // Captura quais subtarefas tinham painel de etapas internas aberto antes da reordenação
    const openSubIds = new Set();
    task.subtasks.forEach((s, idx) => {
        if (expandedCardSubtasksSet.has(`${task.id}::${idx}`)) {
            openSubIds.add(s.id);
        }
        expandedCardSubtasksSet.delete(`${task.id}::${idx}`);
    });

    const completedSubs = task.subtasks
        .filter(s => Boolean(s.completed))
        .sort((a, b) => {
            const cA = typeof a.completedOrder === 'number' ? a.completedOrder : (a.completedAt || 0);
            const cB = typeof b.completedOrder === 'number' ? b.completedOrder : (b.completedAt || 0);
            if (cA !== cB) return cA - cB;
            return (a.originalOrder ?? 0) - (b.originalOrder ?? 0);
        });

    const pendingSubs = task.subtasks
        .filter(s => !s.completed)
        .sort((a, b) => (a.originalOrder ?? 0) - (b.originalOrder ?? 0));

    task.subtasks = [...completedSubs, ...pendingSubs];

    // Restaura estado de expansão de etapas internas nos novos índices
    task.subtasks.forEach((s, newIdx) => {
        if (openSubIds.has(s.id)) {
            expandedCardSubtasksSet.add(`${task.id}::${newIdx}`);
        }
    });
}

function getInnerTaskBlockInfo(innerList, innerIdx) {
    if (!Array.isArray(innerList) || !innerList[innerIdx]) {
        return { hasDependency: false, isBlocked: false, depIndex: -1, depText: '' };
    }
    const item = innerList[innerIdx];
    if (!item.dependsOn) {
        return { hasDependency: false, isBlocked: false, depIndex: -1, depText: '' };
    }
    const depIdx = innerList.findIndex((cand, idx) =>
        (cand.id && cand.id === item.dependsOn) || String(idx) === String(item.dependsOn)
    );
    if (depIdx === -1 || depIdx === innerIdx) {
        return { hasDependency: false, isBlocked: false, depIndex: -1, depText: '' };
    }
    const depItem = innerList[depIdx];
    return {
        hasDependency: true,
        isBlocked: !depItem.completed,
        depIndex: depIdx,
        depText: depItem.text || `Etapa #${depIdx + 1}`
    };
}

function wouldCreateInnerTaskCycle(innerList, targetIdx, newDepId) {
    if (!newDepId) return false;
    const targetItem = innerList[targetIdx];
    if (!targetItem) return false;
    if (targetItem.id === newDepId) return true;

    let currDepId = newDepId;
    const visited = new Set();
    while (currDepId) {
        if (visited.has(currDepId)) return true;
        visited.add(currDepId);
        if (currDepId === targetItem.id) return true;
        const parentItem = innerList.find(i => i.id === currDepId);
        currDepId = parentItem ? parentItem.dependsOn : null;
    }
    return false;
}

function cascadeUncheckInnerTasks(innerList, uncheckedIdx) {
    const uncheckedItem = innerList[uncheckedIdx];
    if (!uncheckedItem) return 0;
    let count = 0;
    innerList.forEach((it, idx) => {
        if (idx !== uncheckedIdx && it.completed && (it.dependsOn === uncheckedItem.id || String(it.dependsOn) === String(uncheckedIdx))) {
            it.completed = false;
            count++;
            count += cascadeUncheckInnerTasks(innerList, idx);
        }
    });
    return count;
}

function openTaskModalAndFocusSubtask(taskId, subIdx) {
    openTaskModal(taskId);
    activeExpandedSubtaskIdx = subIdx;
    renderModalSubtasks();
    setTimeout(() => {
        const inp = document.getElementById(`newInnerTaskText_${subIdx}`);
        if (inp) inp.focus();
    }, 100);
}

function toggleExpandModalSubtask(subIdx) {
    activeExpandedSubtaskIdx = (activeExpandedSubtaskIdx === subIdx) ? -1 : subIdx;
    renderModalSubtasks();
}

function addSubtaskToModal() {
    const input = document.getElementById('newSubtaskInput');
    const hoursInput = document.getElementById('newSubtaskHoursInput');
    const assigneeInput = document.getElementById('newSubtaskAssigneeInput');
    const text = input.value.trim();
    if (!text) return;

    const assignee = (assigneeInput?.value || '').trim() || document.getElementById('taskAuthorInput')?.value.trim() || '';
    const hours = Math.max(0.1, Math.round((parseFloat(hoursInput?.value) || 2) * 10) / 10);
    ensureSubtaskStructure(modalSubtasks);
    const newId = 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    modalSubtasks.push({
        id: newId,
        text,
        assignee,
        hours,
        completed: false,
        innerTasks: []
    });
    // Mantém as tarefas internas ocultas por padrão até o usuário pedir para ver
    activeExpandedSubtaskIdx = -1;
    input.value = '';
    renderModalSubtasks();
    input.focus();
}

function updateModalSubtaskHours(subIdx, newHoursVal) {
    ensureSubtaskStructure(modalSubtasks);
    if (!modalSubtasks[subIdx]) return;
    const h = Math.max(0.1, Math.round((parseFloat(newHoursVal) || 0.5) * 10) / 10);
    modalSubtasks[subIdx].hours = h;
    renderModalSubtasks();
}

function adjustModalSubtaskHoursDelta(subIdx, delta) {
    ensureSubtaskStructure(modalSubtasks);
    if (!modalSubtasks[subIdx]) return;
    const cur = Number(modalSubtasks[subIdx].hours) || 2;
    modalSubtasks[subIdx].hours = Math.max(0.1, Math.round((cur + delta) * 10) / 10);
    renderModalSubtasks();
}

// =========================================================================
// MOTOR DE TEMPO DA TAREFA MACRO & REDISTRIBUIÇÃO AUTOMÁTICA ENTRE SUBTAREFAS
// - Permite determinar o Tempo Total da Tarefa Macro e distribuir entre as subtarefas pendentes
// - Quando uma subtarefa é designada para outro membro da equipe, o tempo dela
//   é distribuído automaticamente entre as subtarefas restantes que ainda não foram concluídas!
// =========================================================================
let _pendingSubtaskHoursCallback = null;
let _decisionModalMeta = {
    pendingCount: 0,
    completedCount: 0,
    completedHoursSum: 0,
    mode: 'macro' // 'macro' (Tempo Total da Tarefa Macro) | 'per_sub' (Horas por Subtarefa)
};

/**
 * Redistribui automaticamente o tempo de uma subtarefa que foi designada para outro membro da equipe
 * entre as subtarefas restantes que ainda não foram concluídas.
 */
function redistributeReassignedSubtaskHours(subtasksArray, targetSubIdx, previousAssignee, newAssignee, fallbackTaskOwner = '') {
    if (!Array.isArray(subtasksArray) || !subtasksArray[targetSubIdx]) {
        return { redistributed: false };
    }
    const targetSub = subtasksArray[targetSubIdx];
    if (targetSub.completed) {
        return { redistributed: false };
    }

    const cleanPrev = normalizeIdentityStr(previousAssignee || fallbackTaskOwner);
    const cleanNew  = normalizeIdentityStr(newAssignee);

    // Só redistribui quando é efetivamente designada para um membro diferente do anterior
    if (!cleanNew || cleanNew === cleanPrev) {
        return { redistributed: false };
    }

    const freedHours = Math.max(0.1, Number(targetSub.hours) || 2);

    // Prioriza as subtarefas restantes não concluídas do membro anterior (ou do responsável principal da tarefa).
    // Caso todas as restantes não concluídas não tenham responsável explícito, distribui entre todas as restantes não concluídas.
    let remainingCandidates = subtasksArray.filter((s, idx) => {
        if (idx === targetSubIdx || Boolean(s.completed)) return false;
        const sOwner = normalizeIdentityStr(s.assignee || fallbackTaskOwner);
        return cleanPrev ? (sOwner === cleanPrev) : true;
    });

    if (remainingCandidates.length === 0) {
        remainingCandidates = subtasksArray.filter((s, idx) => idx !== targetSubIdx && !s.completed);
    }

    if (remainingCandidates.length === 0) {
        return { redistributed: false };
    }

    const extraHoursPerRemaining = freedHours / remainingCandidates.length;
    remainingCandidates.forEach(s => {
        const currentH = Math.max(0.1, Number(s.hours) || 2);
        s.hours = Math.max(0.1, Math.round((currentH + extraHoursPerRemaining) * 10) / 10);
    });

    return {
        redistributed: true,
        freedHours,
        remainingCount: remainingCandidates.length,
        extraHoursPerRemaining: Math.round(extraHoursPerRemaining * 10) / 10,
        previousOwnerLabel: previousAssignee || fallbackTaskOwner || 'Equipe'
    };
}

/**
 * Distribui o Tempo Total da Tarefa Macro informado no Modal de Criação/Edição
 * entre as subtarefas que ainda não foram concluídas.
 */
function distributeMacroTotalHoursInModal() {
    ensureSubtaskStructure(modalSubtasks);
    if (modalSubtasks.length === 0) {
        showToast('Adicione pelo menos 1 subtarefa antes de distribuir o Tempo da Tarefa Macro.', 'info');
        return;
    }

    const pendingSubs = modalSubtasks.filter(s => !s.completed);
    const completedSubs = modalSubtasks.filter(s => Boolean(s.completed));
    if (pendingSubs.length === 0) {
        showToast('Todas as subtarefas já foram concluídas! Nenhuma hora pendente para alterar.', 'info');
        return;
    }

    const macroInp = document.getElementById('taskMacroHoursInput');
    const rawMacroHours = parseFloat(macroInp?.value);
    if (isNaN(rawMacroHours) || rawMacroHours <= 0) {
        // Se o campo estiver em branco, abre o modal interativo na aba "Tempo da Tarefa Macro"
        autoDistributeModalSubtaskHours('macro');
        return;
    }

    const completedHoursSum = completedSubs.reduce((acc, s) => acc + (Number(s.hours) || 2), 0);
    // Se já houver subtarefas concluídas e o tempo macro for maior que a soma concluída, desconta as concluídas ou divide o saldo entre as pendentes
    const distributableHours = (completedHoursSum > 0 && rawMacroHours > completedHoursSum)
        ? (rawMacroHours - completedHoursSum)
        : rawMacroHours;

    // Filtra prioritariamente as subtarefas pendentes do responsável principal da tarefa (se houver), ou todas as pendentes
    const taskOwner = (document.getElementById('taskAuthorInput')?.value || currentAuthor || '').trim();
    let targetPendingSubs = pendingSubs.filter(s => !s.assignee || doesAssigneeMatchUser(s.assignee, taskOwner));
    if (targetPendingSubs.length === 0) {
        targetPendingSubs = pendingSubs;
    }

    const hoursPerSub = Math.max(0.1, Math.round((distributableHours / targetPendingSubs.length) * 10) / 10);
    targetPendingSubs.forEach(s => {
        s.hours = hoursPerSub;
    });

    const batchInp = document.getElementById('modalBatchSubtaskHoursInput');
    if (batchInp) batchInp.value = hoursPerSub;

    renderModalSubtasks();
    showToast(
        `Tempo Macro (${rawMacroHours}h) distribuído: ${hoursPerSub}h para cada uma das ${targetPendingSubs.length} subtarefa(s) pendente(s)!`,
        'success'
    );
}

function openSubtaskHoursDistributionModal({
    title,
    subtasksCount,
    completedCount = 0,
    completedHoursSum = 0,
    suggestedHours,
    suggestedMacroHours = null,
    diffDays,
    totalAvailableHours,
    initialMode = 'macro',
    onConfirm
}) {
    _pendingSubtaskHoursCallback = onConfirm;
    const initialPerSub = Math.max(0.1, Number(suggestedHours) || 2);
    const defaultMacroTotal = suggestedMacroHours !== null
        ? Math.max(0.1, Number(suggestedMacroHours))
        : Math.max(0.1, Math.round((initialPerSub * subtasksCount) * 10) / 10);

    _decisionModalMeta = {
        pendingCount: subtasksCount,
        completedCount: Number(completedCount) || 0,
        completedHoursSum: Number(completedHoursSum) || 0,
        mode: initialMode === 'per_sub' ? 'per_sub' : 'macro'
    };

    const existing = document.getElementById('subtaskHoursDecisionModal');
    if (existing) existing.remove();

    const perSubPresets = [0.1, 0.2, 0.5, 1, 1.5, 2, 4, 8];
    const macroPresets  = [8, 16, 24, 32, 40, 64, 80, 120];

    const modalHtml = `
        <div id="subtaskHoursDecisionModal" class="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
            <div class="bg-white dark:bg-darkCard w-full max-w-lg rounded-2xl border border-slate-200 dark:border-darkBorder shadow-2xl overflow-hidden p-6 space-y-4">
                <div class="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700">
                    <h3 class="text-sm sm:text-base font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
                        <i class="fa-solid fa-stopwatch text-amber-500"></i>
                        <span>${escapeHtml(title || 'Definir Tempo da Tarefa Macro & Subtarefas')}</span>
                    </h3>
                    <button type="button" onclick="document.getElementById('subtaskHoursDecisionModal')?.remove()" class="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <!-- Alternador de Modo: 1. Tempo da Tarefa Macro vs 2. Horas por Subtarefa -->
                <div class="grid grid-cols-2 gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold">
                    <button type="button" id="decTabMacroBtn" onclick="switchDecisionModalMode('macro')" class="py-2 px-2.5 rounded-lg transition flex items-center justify-center gap-1.5 bg-indigo-600 text-white shadow-sm">
                        <i class="fa-solid fa-arrows-split-up-and-left"></i>
                        <span>1. Tempo da Tarefa Macro</span>
                    </button>
                    <button type="button" id="decTabPerSubBtn" onclick="switchDecisionModalMode('per_sub')" class="py-2 px-2.5 rounded-lg transition flex items-center justify-center gap-1.5 text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700">
                        <i class="fa-solid fa-boxes-stacked"></i>
                        <span>2. Horas por Subtarefa</span>
                    </button>
                </div>

                <div class="space-y-3 text-xs">
                    ${_decisionModalMeta.completedCount > 0 ? `
                        <div class="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 flex items-center gap-2 text-[11px] font-semibold">
                            <i class="fa-solid fa-lock text-emerald-500"></i>
                            <span><strong>${_decisionModalMeta.completedCount} subtarefa(s) concluída(s) (${_decisionModalMeta.completedHoursSum}h)</strong> serão mantidas intactas sem alteração!</span>
                        </div>
                    ` : ''}

                    <!-- PAINEL MODO 1: DETERMINAR TEMPO TOTAL DA TAREFA MACRO E DIVIDIR ENTRE AS SUBTAREFAS -->
                    <div id="decModeMacroSection" class="space-y-3">
                        <p class="text-slate-500 dark:text-slate-400 leading-relaxed">
                            Determine a <strong>carga horária total da Tarefa Macro</strong> para dividi-la automaticamente entre as <strong>${subtasksCount} subtarefa(s) pendente(s)</strong>:
                        </p>

                        <div>
                            <span class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Escolha Rápida (Tempo Total da Tarefa Macro):</span>
                            <div class="grid grid-cols-4 gap-1.5">
                                ${macroPresets.map(mp => `
                                    <button type="button" onclick="setDecisionModalMacroTotalValue(${mp})" class="px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-500/20 hover:border-indigo-500/40 border border-slate-200 dark:border-slate-700 font-mono font-bold text-xs text-slate-700 dark:text-slate-200 transition">
                                        ${mp}h (${(mp/8).toFixed(0)}d)
                                    </button>
                                `).join('')}
                            </div>
                        </div>

                        <div class="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 space-y-2">
                            <label class="block text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                                Tempo Total para as ${subtasksCount} Subtarefas Pendentes (Horas):
                            </label>
                            <div class="flex items-center gap-2">
                                <button type="button" onclick="stepDecisionModalMacroTotalValue(-4)" class="w-9 h-9 rounded-xl bg-white dark:bg-slate-800 border border-indigo-500/30 font-extrabold text-xs text-indigo-600 hover:bg-indigo-500/20 transition">-4h</button>
                                <input type="number" id="decisionModalMacroTotalInput" min="0.1" step="0.1" value="${defaultMacroTotal}" oninput="onDecisionModalMacroInput()" class="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-indigo-500/40 text-center font-mono font-extrabold text-base text-indigo-600 dark:text-indigo-400 focus:outline-none">
                                <span class="font-bold text-indigo-600 dark:text-indigo-400 text-xs">h totais</span>
                                <button type="button" onclick="stepDecisionModalMacroTotalValue(4)" class="w-9 h-9 rounded-xl bg-white dark:bg-slate-800 border border-indigo-500/30 font-extrabold text-xs text-indigo-600 hover:bg-indigo-500/20 transition">+4h</button>
                            </div>
                        </div>
                    </div>

                    <!-- PAINEL MODO 2: DETERMINAR HORAS POR SUBTAREFA INDIVIDUAL -->
                    <div id="decModePerSubSection" class="hidden space-y-3">
                        <p class="text-slate-500 dark:text-slate-400 leading-relaxed">
                            Escolha quantas horas devem ser atribuídas a cada uma das <strong>${subtasksCount} subtarefa(s) pendente(s)</strong> (sugestão p/ prazo: ${initialPerSub}h):
                        </p>

                        <div>
                            <span class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Escolha Rápida (Horas por Subtarefa Pendente):</span>
                            <div class="grid grid-cols-4 gap-1.5">
                                ${perSubPresets.map(p => `
                                    <button type="button" onclick="setDecisionModalHoursValue(${p}, ${subtasksCount})" class="px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-amber-500/20 hover:border-amber-500/40 border border-slate-200 dark:border-slate-700 font-mono font-bold text-xs text-slate-700 dark:text-slate-200 transition">
                                        ${p}h
                                    </button>
                                `).join('')}
                            </div>
                            <button type="button" onclick="setDecisionModalHoursValue(${initialPerSub}, ${subtasksCount})" class="mt-1.5 w-full py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/25 font-semibold text-[11px] transition">
                                <i class="fa-solid fa-wand-magic-sparkles mr-1"></i>Usar Sugestão Proporcional ao Prazo (${initialPerSub}h por subtarefa)
                            </button>
                        </div>

                        <div class="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                            <label class="block text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                                Horas por Subtarefa Pendente:
                            </label>
                            <div class="flex items-center gap-2">
                                <button type="button" onclick="stepDecisionModalHoursValue(-0.1, ${subtasksCount})" class="w-9 h-9 rounded-xl bg-white dark:bg-slate-800 border border-amber-500/30 font-extrabold text-sm text-amber-600 hover:bg-amber-500/20 transition">-</button>
                                <input type="number" id="decisionModalHoursInput" min="0.1" step="0.1" value="${initialPerSub}" oninput="updateDecisionModalSummary(${subtasksCount})" class="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-amber-500/40 text-center font-mono font-extrabold text-base text-amber-600 dark:text-amber-400 focus:outline-none">
                                <span class="font-bold text-amber-600 dark:text-amber-400 text-xs">h / pendente</span>
                                <button type="button" onclick="stepDecisionModalHoursValue(0.1, ${subtasksCount})" class="w-9 h-9 rounded-xl bg-white dark:bg-slate-800 border border-amber-500/30 font-extrabold text-sm text-amber-600 hover:bg-amber-500/20 transition">+</button>
                            </div>
                        </div>
                    </div>

                    <!-- Resumo em Tempo Real do Cálculo -->
                    <div id="decisionModalTotalSummary" class="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-600 dark:text-slate-300 text-center">
                    </div>
                </div>

                <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <button type="button" onclick="document.getElementById('subtaskHoursDecisionModal')?.remove()" class="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold">
                        Cancelar
                    </button>
                    <button type="button" onclick="confirmDecisionModalSubtaskHours()" class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md transition flex items-center gap-1.5">
                        <i class="fa-solid fa-check"></i> Distribuir nas Pendentes
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    switchDecisionModalMode(_decisionModalMeta.mode);
}

function switchDecisionModalMode(mode) {
    _decisionModalMeta.mode = mode === 'per_sub' ? 'per_sub' : 'macro';
    const macroSec = document.getElementById('decModeMacroSection');
    const subSec   = document.getElementById('decModePerSubSection');
    const btnMacro = document.getElementById('decTabMacroBtn');
    const btnSub   = document.getElementById('decTabPerSubBtn');

    if (_decisionModalMeta.mode === 'macro') {
        macroSec?.classList.remove('hidden');
        subSec?.classList.add('hidden');
        if (btnMacro) btnMacro.className = 'py-2 px-2.5 rounded-lg transition flex items-center justify-center gap-1.5 bg-indigo-600 text-white shadow-sm';
        if (btnSub)   btnSub.className   = 'py-2 px-2.5 rounded-lg transition flex items-center justify-center gap-1.5 text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700';
        onDecisionModalMacroInput();
    } else {
        macroSec?.classList.add('hidden');
        subSec?.classList.remove('hidden');
        if (btnSub)   btnSub.className   = 'py-2 px-2.5 rounded-lg transition flex items-center justify-center gap-1.5 bg-amber-600 text-white shadow-sm';
        if (btnMacro) btnMacro.className = 'py-2 px-2.5 rounded-lg transition flex items-center justify-center gap-1.5 text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700';
        updateDecisionModalSummary(_decisionModalMeta.pendingCount);
    }
}

function setDecisionModalMacroTotalValue(macroVal) {
    const inp = document.getElementById('decisionModalMacroTotalInput');
    if (inp) {
        inp.value = Math.max(0.1, Number(macroVal) || 8);
        onDecisionModalMacroInput();
    }
}

function stepDecisionModalMacroTotalValue(delta) {
    const inp = document.getElementById('decisionModalMacroTotalInput');
    if (!inp) return;
    const cur = parseFloat(inp.value) || 8;
    inp.value = Math.max(0.1, Math.round((cur + delta) * 10) / 10);
    onDecisionModalMacroInput();
}

function onDecisionModalMacroInput() {
    const macroInp = document.getElementById('decisionModalMacroTotalInput');
    const subInp   = document.getElementById('decisionModalHoursInput');
    const count    = Math.max(1, _decisionModalMeta.pendingCount || 1);
    const macroTotal = Math.max(0.1, parseFloat(macroInp?.value) || 8);
    const perSub = Math.max(0.1, Math.round((macroTotal / count) * 10) / 10);
    if (subInp) subInp.value = perSub;
    renderDecisionModalSummaryText(perSub, macroTotal, count);
}

function setDecisionModalHoursValue(val, subtasksCount) {
    const inp = document.getElementById('decisionModalHoursInput');
    if (inp) {
        inp.value = Math.max(0.1, Math.round(Number(val) * 10) / 10);
        updateDecisionModalSummary(subtasksCount);
    }
}

function stepDecisionModalHoursValue(delta, subtasksCount) {
    const inp = document.getElementById('decisionModalHoursInput');
    if (!inp) return;
    const cur = parseFloat(inp.value) || 2;
    inp.value = Math.max(0.1, Math.round((cur + delta) * 10) / 10);
    updateDecisionModalSummary(subtasksCount);
}

function updateDecisionModalSummary(subtasksCount) {
    const inp = document.getElementById('decisionModalHoursInput');
    const macroInp = document.getElementById('decisionModalMacroTotalInput');
    const count = Math.max(1, subtasksCount || _decisionModalMeta.pendingCount || 1);
    const h = Math.max(0.1, parseFloat(inp?.value) || 0.5);
    const pendingTotal = Math.round((h * count) * 10) / 10;
    if (macroInp) macroInp.value = pendingTotal;
    renderDecisionModalSummaryText(h, pendingTotal, count);
}

function renderDecisionModalSummaryText(perSubHours, pendingTotalHours, count) {
    const sumEl = document.getElementById('decisionModalTotalSummary');
    if (!sumEl) return;
    const grandTotal = pendingTotalHours + (_decisionModalMeta.completedHoursSum || 0);
    const days = (pendingTotalHours / 8).toFixed(1);
    sumEl.innerHTML = `
        Cada uma das <strong>${count} subtarefa(s) pendente(s)</strong> receberá <strong class="text-indigo-600 dark:text-indigo-400">${formatTotalHours1Dec(perSubHours)}h</strong>
        • Soma Pendentes: <strong class="text-amber-600 dark:text-amber-400">${formatTotalHours1Dec(pendingTotalHours)}h</strong> (${days}d úteis)
        ${_decisionModalMeta.completedCount > 0 ? `<br>Total da Tarefa Macro c/ Concluídas: <strong>${formatTotalHours1Dec(grandTotal)}h</strong>` : ''}
    `;
}

function confirmDecisionModalSubtaskHours() {
    const count = Math.max(1, _decisionModalMeta.pendingCount || 1);
    let chosenHours = 2;
    let chosenMacroTotal = count * 2;

    if (_decisionModalMeta.mode === 'macro') {
        const macroInp = document.getElementById('decisionModalMacroTotalInput');
        chosenMacroTotal = Math.max(0.1, parseFloat(macroInp?.value) || 8);
        chosenHours = Math.max(0.1, Math.round((chosenMacroTotal / count) * 10) / 10);
    } else {
        const subInp = document.getElementById('decisionModalHoursInput');
        chosenHours = Math.max(0.1, Math.round((parseFloat(subInp?.value) || 2) * 10) / 10);
        chosenMacroTotal = Math.round((chosenHours * count) * 10) / 10;
    }

    document.getElementById('subtaskHoursDecisionModal')?.remove();
    if (typeof _pendingSubtaskHoursCallback === 'function') {
        const cb = _pendingSubtaskHoursCallback;
        _pendingSubtaskHoursCallback = null;
        cb(chosenHours, chosenMacroTotal);
    }
}

function autoDistributeModalSubtaskHours(preferredMode = 'macro') {
    ensureSubtaskStructure(modalSubtasks);
    if (modalSubtasks.length === 0) {
        showToast('Adicione pelo menos 1 subtarefa para distribuir as horas.', 'info');
        return;
    }

    // Filtra apenas subtarefas PENDENTES (não altera as que já foram concluídas!)
    const pendingSubs = modalSubtasks.filter(s => !s.completed);
    const completedSubs = modalSubtasks.filter(s => Boolean(s.completed));
    if (pendingSubs.length === 0) {
        showToast('Todas as subtarefas já estão concluídas! Nenhuma hora foi alterada.', 'info');
        return;
    }

    const completedHoursSum = completedSubs.reduce((acc, s) => acc + (Number(s.hours) || 2), 0);

    const dueStr = document.getElementById('taskDueDateInput')?.value || getLocalDateStr(1);
    const todayStr = getLocalDateStr(0);
    const d1 = new Date(todayStr + 'T00:00:00');
    const d2 = new Date(dueStr + 'T00:00:00');
    const diffDays = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) || 1);
    const totalAvailableHours = diffDays * 8;
    const remainingBudgetHours = Math.max(pendingSubs.length * 0.1, totalAvailableHours - completedHoursSum);
    const suggestedHours = Math.max(0.1, Math.round((remainingBudgetHours / pendingSubs.length) * 10) / 10);

    const currentPendingSum = roundHours1Dec(pendingSubs.reduce((acc, s) => acc + (Number(s.hours) || 2), 0), 0.1);
    const macroInpVal = parseFloat(document.getElementById('taskMacroHoursInput')?.value);
    const suggestedMacro = currentPendingSum > 0
        ? currentPendingSum
        : ((!isNaN(macroInpVal) && macroInpVal > 0) ? macroInpVal : remainingBudgetHours);

    openSubtaskHoursDistributionModal({
        title: 'Distribuir Tempo da Tarefa Macro entre Subtarefas',
        subtasksCount: pendingSubs.length,
        completedCount: completedSubs.length,
        completedHoursSum,
        suggestedHours,
        suggestedMacroHours: suggestedMacro,
        diffDays,
        totalAvailableHours,
        initialMode: preferredMode || 'macro',
        onConfirm: (chosenHours, chosenMacroTotal) => {
            const batchInp = document.getElementById('modalBatchSubtaskHoursInput');
            if (batchInp) batchInp.value = chosenHours;
            const macroInp = document.getElementById('taskMacroHoursInput');
            if (macroInp) macroInp.value = Math.round((chosenMacroTotal + completedHoursSum) * 10) / 10;

            modalSubtasks.forEach(s => {
                if (!s.completed) {
                    s.hours = chosenHours;
                }
            });
            renderModalSubtasks();
            showToast(
                completedSubs.length > 0
                    ? `Tempo Macro distribuído: ${chosenHours}h para cada uma das ${pendingSubs.length} pendente(s) (${completedSubs.length} concluída(s) preservada(s)).`
                    : `Tempo Macro (${chosenMacroTotal}h) distribuído: ${chosenHours}h por subtarefa!`,
                'success'
            );
        }
    });
}

function updateModalSubtaskAssignee(subIdx, newAssignee) {
    ensureSubtaskStructure(modalSubtasks);
    if (!modalSubtasks[subIdx]) return;
    const fallbackOwner = (document.getElementById('taskAuthorInput')?.value || currentAuthor || '').trim();
    const prevAssignee = (modalSubtasks[subIdx].assignee || fallbackOwner).trim();
    const cleanNew = (newAssignee || '').trim();
    modalSubtasks[subIdx].assignee = cleanNew;

    // Se a subtarefa foi designada para outro membro da equipe, o tempo dela é distribuído entre as subtarefas restantes não concluídas!
    const redist = redistributeReassignedSubtaskHours(modalSubtasks, subIdx, prevAssignee, cleanNew, fallbackOwner);
    if (redist.redistributed) {
        renderModalSubtasks();
        showToast(
            `Subtarefa #${subIdx + 1} designada a "${cleanNew}". As ${redist.freedHours}h dela foram distribuídas (+${redist.extraHoursPerRemaining}h) entre as ${redist.remainingCount} subtarefa(s) pendente(s) restante(s)!`,
            'info'
        );
    }
}

function handleSubtaskEnter(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        addSubtaskToModal();
    }
}

function removeModalSubtask(index) {
    modalSubtasks.splice(index, 1);
    if (activeExpandedSubtaskIdx === index) activeExpandedSubtaskIdx = -1;
    renderModalSubtasks();
}

function addInnerTaskToModalSubtask(subIdx) {
    ensureSubtaskStructure(modalSubtasks);
    const sub = modalSubtasks[subIdx];
    if (!sub) return;

    const textInp = document.getElementById(`newInnerTaskText_${subIdx}`);
    const assigneeInp = document.getElementById(`newInnerTaskAssignee_${subIdx}`);
    const depSel = document.getElementById(`newInnerTaskDep_${subIdx}`);

    const text = (textInp?.value || '').trim();
    if (!text) {
        showToast('Digite o nome da tarefa/etapa a ser atribuída na subtarefa.', 'error');
        return;
    }
    const assignee = (assigneeInp?.value || '').trim() || sub.assignee || '';
    const dependsOn = (depSel?.value || '') || null;

    sub.innerTasks.push({
        id: 'in_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        text,
        assignee,
        completed: false,
        dependsOn
    });
    sub.completed = false;

    if (textInp) textInp.value = '';
    renderModalSubtasks();
    setTimeout(() => document.getElementById(`newInnerTaskText_${subIdx}`)?.focus(), 30);
}

function handleInnerTaskEnter(e, subIdx) {
    if (e.key === 'Enter') {
        e.preventDefault();
        addInnerTaskToModalSubtask(subIdx);
    }
}

function removeInnerTaskFromModalSubtask(subIdx, innerIdx) {
    ensureSubtaskStructure(modalSubtasks);
    const sub = modalSubtasks[subIdx];
    if (!sub || !sub.innerTasks[innerIdx]) return;

    const removed = sub.innerTasks[innerIdx];
    sub.innerTasks.splice(innerIdx, 1);
    if (removed && removed.id) {
        sub.innerTasks.forEach(it => {
            if (it.dependsOn === removed.id) it.dependsOn = null;
        });
    }
    if (sub.innerTasks.length > 0) {
        sub.completed = sub.innerTasks.every(it => it.completed);
    }
    renderModalSubtasks();
}

function updateInnerTaskDependency(subIdx, innerIdx, newDepId) {
    ensureSubtaskStructure(modalSubtasks);
    const sub = modalSubtasks[subIdx];
    if (!sub || !sub.innerTasks[innerIdx]) return;

    const depVal = newDepId || null;
    if (depVal && wouldCreateInnerTaskCycle(sub.innerTasks, innerIdx, depVal)) {
        showToast('Dependência circular detectada entre as tarefas desta subtarefa!', 'error');
        renderModalSubtasks();
        return;
    }
    sub.innerTasks[innerIdx].dependsOn = depVal;
    const depInfo = getInnerTaskBlockInfo(sub.innerTasks, innerIdx);
    if (depInfo.isBlocked && sub.innerTasks[innerIdx].completed) {
        sub.innerTasks[innerIdx].completed = false;
        cascadeUncheckInnerTasks(sub.innerTasks, innerIdx);
        sub.completed = false;
    }
    renderModalSubtasks();
}

function updateInnerTaskAssignee(subIdx, innerIdx, newAssignee) {
    ensureSubtaskStructure(modalSubtasks);
    const sub = modalSubtasks[subIdx];
    if (!sub || !sub.innerTasks[innerIdx]) return;
    sub.innerTasks[innerIdx].assignee = (newAssignee || '').trim();
}

function chainInnerTasksSequentially(subIdx) {
    ensureSubtaskStructure(modalSubtasks);
    const sub = modalSubtasks[subIdx];
    if (!sub || sub.innerTasks.length < 2) {
        showToast('Adicione pelo menos 2 tarefas dentro desta subtarefa para encadear.', 'info');
        return;
    }
    sub.innerTasks.forEach((it, idx) => {
        it.dependsOn = idx === 0 ? null : sub.innerTasks[idx - 1].id;
        if (idx > 0 && !sub.innerTasks[idx - 1].completed && it.completed) {
            it.completed = false;
        }
    });
    sub.completed = sub.innerTasks.every(it => it.completed);
    renderModalSubtasks();
    showToast('Tarefas internas encadeadas em sequência (#1 → #2 → #3...)', 'success');
}

function applyPresetInnerTasksToSubtask(subIdx, stepsArray) {
    ensureSubtaskStructure(modalSubtasks);
    const sub = modalSubtasks[subIdx];
    if (!sub) return;

    const existingTexts = (sub.innerTasks || []).map(it => String(it.text || '').trim().toLowerCase());
    const alreadyHasWorkflow = Boolean(sub.workflowApplied) || stepsArray.every(st => existingTexts.includes(String(st).trim().toLowerCase()));
    if (alreadyHasWorkflow) {
        showToast('O fluxo de trabalho já foi aplicado nesta subtarefa e só pode ser utilizado uma vez por subtarefa.', 'error');
        return;
    }

    const defaultAuthor = sub.assignee || document.getElementById('taskAuthorInput')?.value.trim() || currentAuthor || '';

    let prevId = sub.innerTasks.length > 0 ? sub.innerTasks[sub.innerTasks.length - 1].id : null;
    stepsArray.forEach((stepText, sIdx) => {
        const newId = 'in_' + Date.now() + '_' + subIdx + '_' + sIdx + '_' + Math.random().toString(36).substring(2, 5);
        sub.innerTasks.push({
            id: newId,
            text: stepText,
            assignee: defaultAuthor,
            completed: false,
            dependsOn: prevId
        });
        prevId = newId;
    });
    sub.workflowApplied = true;
    sub.completed = false;
    activeExpandedSubtaskIdx = subIdx;
    renderModalSubtasks();
    showToast(`Fluxo de trabalho aplicado com sucesso à subtarefa #${subIdx + 1}!`, 'success');
}

function applyDefaultFlowToAllModalSubtasks() {
    ensureSubtaskStructure(modalSubtasks);
    if (modalSubtasks.length === 0) {
        showToast('Adicione pelo menos uma subtarefa primeiro.', 'info');
        return;
    }
    const defaultSteps = ['Modelagem 3D', 'Detalhamento Técnico', 'Revisão & Liberação'];
    const fallbackAuthor = document.getElementById('taskAuthorInput')?.value.trim() || currentAuthor || '';

    modalSubtasks.forEach((sub, sIdx) => {
        const subOwner = sub.assignee || fallbackAuthor;
        if (!Array.isArray(sub.innerTasks) || sub.innerTasks.length === 0) {
            let prevId = null;
            defaultSteps.forEach((stepName, k) => {
                const newId = 'in_' + Date.now() + '_' + sIdx + '_' + k + '_' + Math.random().toString(36).substring(2, 5);
                sub.innerTasks.push({
                    id: newId,
                    text: stepName,
                    assignee: subOwner,
                    completed: false,
                    dependsOn: prevId
                });
                prevId = newId;
            });
            sub.completed = false;
        }
    });
    renderModalSubtasks();
    showToast('Fluxo de tarefas encadeadas aplicado a todas as subtarefas!', 'success');
}

function renderModalSubtasks() {
    const listEl = document.getElementById('modalSubtasksList');
    if (!listEl) return;
    ensureSubtaskStructure(modalSubtasks);

    const totalModalHours = Math.round(modalSubtasks.reduce((acc, s) => acc + (Number(s.hours) || 0), 0) * 10) / 10;
    const totalModalHoursStr = formatTotalHours1Dec(totalModalHours);
    const modalHoursBadge = document.getElementById('modalTotalHoursBadge');
    if (modalHoursBadge) {
        const eqDays = (totalModalHours / 8).toFixed(1);
        modalHoursBadge.innerHTML = `<i class="fa-regular fa-clock mr-1"></i>Total: ${totalModalHoursStr}h (${eqDays}d úteis de 8h)`;
    }

    if (modalSubtasks.length === 0) {
        listEl.innerHTML = `<li class="text-xs text-slate-400 italic py-2 text-center">Nenhuma subtarefa adicionada ainda.</li>`;
        return;
    }

    const taskAuthorVal = document.getElementById('taskAuthorInput')?.value || '';
    const modalDueDateVal = document.getElementById('taskDueDateInput')?.value || '';
    const editingTaskId = document.getElementById('taskIdInput')?.value || '';
    const existingTask = editingTaskId ? tasks.find(t => t.id === editingTaskId) : null;
    const modalDeadlineEval = evaluateTaskSubtasksDeadlineInfo({
        id: editingTaskId || null,
        dueDate: modalDueDateVal,
        createdAt: existingTask?.createdAt || Date.now(),
        simultaneous: Boolean(document.getElementById('taskSimultaneousInput')?.checked),
        subtasks: modalSubtasks
    });

    if (modalHoursBadge && modalDeadlineEval.exceedingPendingCount > 0) {
        const eqDays = (totalModalHours / 8).toFixed(1);
        modalHoursBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-500 mr-1"></i>Total: ${totalModalHoursStr}h (${eqDays}d) • <span class="text-rose-600 dark:text-rose-400 font-extrabold">${modalDeadlineEval.exceedingPendingCount} subtarefa(s) excede(m) o prazo!</span>`;
    }

    const isModalTaskOwner = isCurrentUserAdmin || doesAssigneeMatchUser(taskAuthorVal, currentAuthor, currentUserLogin);

    listEl.innerHTML = modalSubtasks.map((sub, sIdx) => {
        const subModalDl = modalDeadlineEval.subtaskMap[sIdx] || {};
        const subModalExceeds = Boolean(subModalDl.exceedsDeadline && !sub.completed);
        const innerList = sub.innerTasks || [];
        const isExpanded = activeExpandedSubtaskIdx === sIdx;
        const doneInner = innerList.filter(i => i.completed).length;
        const isSubOwner = isModalTaskOwner || doesAssigneeMatchUser(sub.assignee, currentAuthor, currentUserLogin);

        const newInnerDepOptions = `<option value="">🔓 Sem dependência</option>` +
            innerList.map((cand, cIdx) => {
                const shortLbl = cand.text.length > 22 ? cand.text.substring(0, 22) + '…' : cand.text;
                const sel = (cIdx === innerList.length - 1) ? 'selected' : '';
                return `<option value="${escapeHtml(cand.id)}" ${sel}>🔗 Depende de #${cIdx + 1}: ${escapeHtml(shortLbl)}</option>`;
            }).join('');

        return `
            <li class="rounded-xl bg-slate-50 dark:bg-slate-800/70 border ${subModalExceeds ? 'border-rose-500/60 ring-1 ring-rose-500/30' : (isExpanded ? 'border-indigo-500/50 shadow-sm' : 'border-slate-200 dark:border-slate-700')} overflow-hidden transition">
                <!-- Cabeçalho da Subtarefa no Modal + Reordenação + Atribuição de Membro (Dropdown ao clicar) -->
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 ${subModalExceeds ? 'bg-rose-500/10 dark:bg-rose-950/30' : 'bg-white/60 dark:bg-slate-800'}">
                    <div class="flex items-center gap-1.5 min-w-0 flex-1">
                        <!-- Botões Reordenar Subtarefa no Modal -->
                        <div class="inline-flex items-center rounded bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 p-0.5 shrink-0">
                            <button type="button" onclick="moveModalSubtaskOrder(${sIdx}, -1)" ${sIdx === 0 ? 'disabled' : ''} class="w-4 h-4 rounded hover:bg-white dark:hover:bg-slate-600 disabled:opacity-30 text-slate-600 dark:text-slate-300 flex items-center justify-center transition" title="Subir subtarefa">
                                <i class="fa-solid fa-chevron-up text-[8px]"></i>
                            </button>
                            <button type="button" onclick="moveModalSubtaskOrder(${sIdx}, 1)" ${sIdx === modalSubtasks.length - 1 ? 'disabled' : ''} class="w-4 h-4 rounded hover:bg-white dark:hover:bg-slate-600 disabled:opacity-30 text-slate-600 dark:text-slate-300 flex items-center justify-center transition" title="Descer subtarefa">
                                <i class="fa-solid fa-chevron-down text-[8px]"></i>
                            </button>
                        </div>
                        <span class="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono font-bold text-[10px] shrink-0">Item #${sIdx + 1}</span>
                        <span class="truncate text-xs font-bold text-slate-800 dark:text-slate-100 ${sub.completed ? 'line-through opacity-60' : ''}" title="${escapeHtml(sub.text)}">${escapeHtml(sub.text)}</span>
                        ${subModalExceeds ? `
                            <span class="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[9px] font-extrabold shrink-0" title="Previsão de término (${subModalDl.endFormatted}) ultrapassa o vencimento da tarefa!">
                                <i class="fa-solid fa-triangle-exclamation mr-0.5"></i>Excede prazo (${subModalDl.endFormatted})
                            </span>
                        ` : ''}
                    </div>
                    <div class="flex flex-wrap sm:flex-nowrap items-center gap-1.5 shrink-0">
                        <!-- Controle de Ajuste de Horas da Subtarefa -->
                        <div class="inline-flex items-center rounded-lg bg-amber-500/10 border border-amber-500/25 px-1 py-0.5 gap-0.5" title="Ajustar horas estimadas desta subtarefa (8h = 1 dia)">
                            <button type="button" onclick="adjustModalSubtaskHoursDelta(${sIdx}, -0.5)" class="w-4 h-4 rounded hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-xs">-</button>
                            <input type="number" min="0.1" step="0.1" value="${Number(sub.hours || 2)}" onchange="updateModalSubtaskHours(${sIdx}, this.value)" class="w-11 bg-transparent text-center font-mono font-bold text-[11px] text-amber-700 dark:text-amber-300 focus:outline-none">
                            <span class="text-[9px] font-bold text-amber-600 dark:text-amber-400">h</span>
                            <button type="button" onclick="adjustModalSubtaskHoursDelta(${sIdx}, 0.5)" class="w-4 h-4 rounded hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-xs">+</button>
                        </div>
                        <select onchange="updateModalSubtaskAssignee(${sIdx}, this.value)" class="w-36 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer" title="Membro da equipe responsável por esta subtarefa">
                            ${buildMemberSelectOptionsHTML(sub.assignee || '', isSubOwner, '👤 Atribuir membro...')}
                        </select>
                        <button type="button" onclick="toggleExpandModalSubtask(${sIdx})" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition flex items-center gap-1 ${
                            isExpanded
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20'
                        }" title="${isExpanded ? 'Ocultar tarefas internas' : 'Mostrar tarefas internas desta subtarefa'}">
                            <i class="fa-solid ${isExpanded ? 'fa-eye-slash' : 'fa-diagram-project'} text-[10px]"></i>
                            <span>${isExpanded ? 'Ocultar' : 'Tarefas'} (${doneInner}/${innerList.length})</span>
                        </button>
                        <button type="button" onclick="removeModalSubtask(${sIdx})" class="text-slate-400 hover:text-rose-500 transition px-1.5 py-1" title="Excluir subtarefa">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    </div>
                </div>

                <!-- Painel Interno (Oculto por padrão, aberto apenas quando solicitado) -->
                <div class="${isExpanded ? 'block' : 'hidden'} p-3 border-t border-slate-200/80 dark:border-slate-700/80 space-y-2.5 bg-slate-100/60 dark:bg-slate-900/40">
                    <div class="flex flex-wrap items-center justify-between gap-1.5">
                        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <i class="fa-solid fa-list-check text-emerald-500 mr-1"></i>Tarefas internas da subtarefa & Dependências:
                        </span>
                        <div class="flex flex-wrap items-center gap-1">
                            ${(sub.workflowApplied || ['modelagem 3d', 'detalhamento técnico', 'liberação'].every(st => innerList.some(it => String(it.text || '').trim().toLowerCase() === st))) ? `
                                <button type="button" disabled class="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-300 dark:border-slate-700 text-[10px] font-semibold cursor-not-allowed flex items-center gap-1" title="O fluxo de trabalho só pode ser utilizado uma única vez por subtarefa">
                                    <i class="fa-solid fa-check-double text-[9px]"></i> Fluxo de Trabalho Aplicado
                                </button>
                            ` : `
                                <button type="button" onclick="applyPresetInnerTasksToSubtask(${sIdx}, ['Modelagem 3D', 'Detalhamento Técnico', 'Liberação'])" class="px-2 py-0.5 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/25 text-[10px] font-semibold transition flex items-center gap-1" title="Inserir etapas do fluxo de trabalho nesta subtarefa (uso único por subtarefa)">
                                    <i class="fa-solid fa-diagram-project text-[9px]"></i> + Fluxo de Trabalho
                                </button>
                            `}
                            <button type="button" onclick="chainInnerTasksSequentially(${sIdx})" class="px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/25 text-[10px] font-semibold transition" title="Encadear tarefas internas em sequência (#1 → #2 → #3)">
                                <i class="fa-solid fa-link mr-0.5"></i>Encadear
                            </button>
                        </div>
                    </div>

                    <!-- Input para Nova Tarefa Interna dentro da Subtarefa -->
                    <div class="grid grid-cols-1 sm:grid-cols-12 gap-1.5">
                        <input type="text" id="newInnerTaskText_${sIdx}" onkeydown="handleInnerTaskEnter(event, ${sIdx})" placeholder="Nova tarefa interna (ex: Corte Laser, Modelagem 3D)..." class="sm:col-span-5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs focus:outline-none focus:border-indigo-500">
                        <select id="newInnerTaskAssignee_${sIdx}" class="sm:col-span-3 px-2 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs focus:outline-none focus:border-indigo-500 cursor-pointer">
                            ${buildMemberSelectOptionsHTML(sub.assignee || currentAuthor || '', isSubOwner, '👤 Responsável...')}
                        </select>
                        <select id="newInnerTaskDep_${sIdx}" class="sm:col-span-3 px-2 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 focus:outline-none focus:border-indigo-500">
                            ${newInnerDepOptions}
                        </select>
                        <button type="button" onclick="addInnerTaskToModalSubtask(${sIdx})" class="sm:col-span-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition flex items-center justify-center" title="Adicionar tarefa interna">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                    </div>

                    <!-- Lista de Tarefas Internas da Subtarefa -->
                    ${innerList.length === 0 ? `
                        <p class="text-[11px] text-slate-400 italic py-1">Nenhuma tarefa interna adicionada nesta subtarefa. Adicione manualmente acima se necessário.</p>
                    ` : `
                        <div class="space-y-1.5 pt-1">
                            ${innerList.map((inTask, iIdx) => {
                                const depOpts = `<option value="">🔓 Livre (Sem pré-requisito)</option>` +
                                    innerList.map((cand, cIdx) => {
                                        if (cIdx === iIdx) return '';
                                        const sel = inTask.dependsOn === cand.id ? 'selected' : '';
                                        const shortTxt = cand.text.length > 20 ? cand.text.substring(0, 20) + '…' : cand.text;
                                        return `<option value="${escapeHtml(cand.id)}" ${sel}>🔗 Depende de #${cIdx + 1}: ${escapeHtml(shortTxt)}</option>`;
                                    }).join('');

                                return `
                                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                                        <div class="flex items-center gap-1.5 min-w-0 flex-1">
                                            <div class="inline-flex items-center rounded bg-slate-100 dark:bg-slate-700 p-0.5 shrink-0">
                                                <button type="button" onclick="moveModalInnerTaskOrder(${sIdx}, ${iIdx}, -1)" ${iIdx === 0 ? 'disabled' : ''} class="w-3.5 h-3.5 rounded hover:bg-white dark:hover:bg-slate-600 disabled:opacity-30 text-slate-500 flex items-center justify-center" title="Subir etapa">
                                                    <i class="fa-solid fa-caret-up text-[8px]"></i>
                                                </button>
                                                <button type="button" onclick="moveModalInnerTaskOrder(${sIdx}, ${iIdx}, 1)" ${iIdx === innerList.length - 1 ? 'disabled' : ''} class="w-3.5 h-3.5 rounded hover:bg-white dark:hover:bg-slate-600 disabled:opacity-30 text-slate-500 flex items-center justify-center" title="Descer etapa">
                                                    <i class="fa-solid fa-caret-down text-[8px]"></i>
                                                </button>
                                            </div>
                                            <span class="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-700 font-mono font-bold text-[10px] text-slate-600 dark:text-slate-300 shrink-0">#${iIdx + 1}</span>
                                            <span class="truncate font-semibold text-slate-700 dark:text-slate-200">${escapeHtml(inTask.text)}</span>
                                        </div>
                                        <div class="flex flex-wrap sm:flex-nowrap items-center gap-1.5 shrink-0">
                                            <select onchange="updateInnerTaskAssignee(${sIdx}, ${iIdx}, this.value)" class="w-32 px-2 py-1 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] cursor-pointer">
                                                ${buildMemberSelectOptionsHTML(inTask.assignee || '', isSubOwner, '👤 Responsável...')}
                                            </select>
                                            <select onchange="updateInnerTaskDependency(${sIdx}, ${iIdx}, this.value)" class="px-2 py-1 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 max-w-[175px]">
                                                ${depOpts}
                                            </select>
                                            <button type="button" onclick="removeInnerTaskFromModalSubtask(${sIdx}, ${iIdx})" class="text-slate-400 hover:text-rose-500 px-1" title="Remover tarefa interna">
                                                <i class="fa-solid fa-xmark"></i>
                                            </button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `}
                </div>
            </li>
        `;
    }).join('');
}

async function saveTaskForm(event) {
    event.preventDefault();
    const idInput = document.getElementById('taskIdInput').value;
    if (idInput && !hasUserPermission('canEdit')) {
        showToast('Permissão negada para editar tarefas.', 'error');
        return;
    }
    if (!idInput && !hasUserPermission('canCreate')) {
        showToast('Permissão negada para criar tarefas.', 'error');
        return;
    }

    const title = document.getElementById('taskTitleInput').value.trim();
    const author = document.getElementById('taskAuthorInput').value.trim() || currentAuthor;
    const desc = document.getElementById('taskDescInput').value.trim();
    const category = 'projeto';
    const priority = document.getElementById('taskPriorityInput').value;
    const dueDate = document.getElementById('taskDueDateInput').value;
    const status = document.getElementById('taskStatusInput').value;
    const simultaneous = Boolean(document.getElementById('taskSimultaneousInput')?.checked);
    const rawMacroHoursVal = parseFloat(document.getElementById('taskMacroHoursInput')?.value);
    const subSumHours = modalSubtasks.reduce((acc, s) => acc + (Number(s.hours) || 2), 0);
    const finalMacroHours = (!isNaN(rawMacroHoursVal) && rawMacroHoursVal > 0)
        ? rawMacroHoursVal
        : (subSumHours > 0 ? subSumHours : 8);

    if (!title) return;

    let taskObj;
    if (idInput) {
        const idx = tasks.findIndex(t => t.id === idInput);
        if (idx !== -1) {
            tasks[idx] = {
                ...tasks[idx],
                title,
                author,
                desc,
                category,
                priority,
                dueDate,
                status,
                simultaneous,
                estimatedHours: finalMacroHours,
                macroTotalHours: finalMacroHours,
                subtasks: modalSubtasks,
                updatedAt: Date.now()
            };
            taskObj = tasks[idx];
        }
    } else {
        taskObj = {
            id: 'task_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now(),
            title,
            author,
            desc,
            category,
            priority,
            dueDate,
            status,
            simultaneous,
            estimatedHours: finalMacroHours,
            macroTotalHours: finalMacroHours,
            subtasks: modalSubtasks,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        tasks.unshift(taskObj);
    }

    closeTaskModal();
    renderAll();
    showToast('Tarefa guardada com sucesso!', 'success');

    if (taskObj) {
        await upsertTaskToCloud(taskObj);
    }
}

async function updateTaskStatus(taskId, newStatus) {
    if (!hasUserPermission('canChangeStatus')) {
        showToast('Você não possui permissão para alterar o status das tarefas.', 'error');
        renderAll();
        return;
    }
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    task.status = newStatus;
    task.updatedAt = Date.now();
    renderAll();
    showToast(`Status atualizado para ${STATUS_META[newStatus]?.label || newStatus}`, 'info');
    await upsertTaskToCloud(task);
}

function recalculateParentTaskStatus(task) {
    if (!task || !Array.isArray(task.subtasks)) return;
    const totalSub = task.subtasks.length;
    const doneSub = task.subtasks.filter(s => s.completed).length;
    const anyInnerDone = task.subtasks.some(s => Array.isArray(s.innerTasks) && s.innerTasks.some(it => it.completed));

    if (totalSub > 0) {
        if (doneSub === totalSub) {
            task.status = 'done';
        } else if (doneSub > 0 || anyInnerDone) {
            task.status = 'in_progress';
        } else if (doneSub === 0 && !anyInnerDone && task.status === 'done') {
            task.status = 'todo';
        }
    }
}

function handleInnerTaskCardClick(event, taskId, subIndex, innerIndex) {
    if (event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'BUTTON')) {
        return;
    }
    toggleInnerTaskStatus(taskId, subIndex, innerIndex);
}


function canUserExecuteTaskElement(task, sub = null, innerTask = null) {
    if (isCurrentUserAdmin) return true;

    // Responsável principal pela Tarefa
    if (task && doesAssigneeMatchUser(task.author, currentAuthor, currentUserLogin)) return true;

    // Responsável pela Subtarefa
    if (sub && doesAssigneeMatchUser(sub.assignee, currentAuthor, currentUserLogin)) return true;

    // Responsável pela Tarefa Interna
    if (innerTask && doesAssigneeMatchUser(innerTask.assignee, currentAuthor, currentUserLogin)) return true;

    return false;
}

async function toggleInnerTaskStatus(taskId, subIndex, innerIndex) {
    if (!hasUserPermission('canManageSubtasks')) {
        showToast('Você não possui permissão para marcar tarefas.', 'error');
        renderAll();
        return;
    }
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.subtasks || !task.subtasks[subIndex]) return;

    ensureSubtaskStructure(task.subtasks);
    const sub = task.subtasks[subIndex];
    const innerList = sub.innerTasks || [];
    const targetInner = innerList[innerIndex];
    if (!targetInner) return;

    // Verifica se o usuário tem permissão (Admin, Resp. da Tarefa, Resp. da Subtarefa ou Resp. da Tarefa Interna)
    if (!canUserExecuteTaskElement(task, sub, targetInner)) {
        showToast('Apenas o Administrador ou o responsável atribuído a esta tarefa/subtarefa pode marcá-la como executada.', 'error');
        renderAll();
        return;
    }

    const depInfo = getInnerTaskBlockInfo(innerList, innerIndex);
    if (!targetInner.completed && depInfo.isBlocked) {
        showToast(`Tarefa bloqueada! Conclua primeiro a etapa #${depInfo.depIndex + 1}: "${depInfo.depText}".`, 'error');
        renderAll();
        return;
    }

    targetInner.completed = !targetInner.completed;

    // Se desmarcar uma tarefa interna que era pré-requisito de outras posteriores nesta subtarefa, desmarca em cascata
    if (!targetInner.completed) {
        const cascaded = cascadeUncheckInnerTasks(innerList, innerIndex);
        if (cascaded > 0) {
            showToast(`${cascaded} etapa(s) dependente(s) reaberta(s) nesta subtarefa.`, 'info');
        }
    }

    // Atualiza automaticamente o status da Subtarefa (Item) conforme conclusão das suas tarefas internas
    const wasSubCompleted = Boolean(sub.completed);
    sub.completed = innerList.length > 0 && innerList.every(it => it.completed);
    if (sub.completed && !wasSubCompleted) {
        sub.completedAt = Date.now();
        const maxCompOrder = Math.max(0, ...task.subtasks.map(s => Number(s.completedOrder) || 0));
        sub.completedOrder = maxCompOrder + 1;
    } else if (!sub.completed) {
        delete sub.completedAt;
        delete sub.completedOrder;
    }

    // Agrupa subtarefas concluídas no topo cedendo espaço para as demais
    groupCompletedSubtasksAtTop(task);

    recalculateParentTaskStatus(task);
    task.updatedAt = Date.now();
    renderAll();
    await upsertTaskToCloud(task);
}

async function toggleSubtaskStatus(taskId, subIndex) {
    if (!hasUserPermission('canManageSubtasks')) {
        showToast('Você não possui permissão para marcar subtarefas.', 'error');
        renderAll();
        return;
    }
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.subtasks || !task.subtasks[subIndex]) return;

    ensureSubtaskStructure(task.subtasks);
    const targetSub = task.subtasks[subIndex];
    const innerList = targetSub.innerTasks || [];

    // Verifica se o usuário tem permissão (Admin, Resp. da Tarefa ou Resp. da Subtarefa)
    if (!canUserExecuteTaskElement(task, targetSub, null)) {
        showToast('Apenas o Administrador ou o responsável atribuído a esta tarefa/subtarefa pode marcá-la como executada.', 'error');
        renderAll();
        return;
    }

    // Ao concluir ou reabrir a subtarefa, registra a ordem de conclusão e agrupa no topo cedendo espaço às pendentes
    targetSub.completed = !targetSub.completed;
    if (targetSub.completed) {
        targetSub.completedAt = Date.now();
        const maxCompOrder = Math.max(0, ...task.subtasks.map(s => Number(s.completedOrder) || 0));
        targetSub.completedOrder = maxCompOrder + 1;
    } else {
        delete targetSub.completedAt;
        delete targetSub.completedOrder;
    }

    // Agrupa as subtarefas concluídas em ordem no topo, puxando e antecipando o espaço para as demais
    groupCompletedSubtasksAtTop(task);

    recalculateParentTaskStatus(task);
    task.updatedAt = Date.now();
    renderAll();
    await upsertTaskToCloud(task);
}

async function deleteTask(taskId) {
    if (!hasUserPermission('canDelete')) {
        showToast('Você não possui permissão para excluir tarefas.', 'error');
        return;
    }
    tasks = tasks.filter(t => t.id !== taskId);
    renderAll();
    showToast('Tarefa excluída.', 'info');
    await removeTaskFromCloud(taskId);
}

function openClearConfirmModal() {
    document.getElementById('confirmClearModal').classList.remove('hidden');
}

function closeClearConfirmModal() {
    document.getElementById('confirmClearModal').classList.add('hidden');
}

async function confirmClearAllTasks() {
    closeClearConfirmModal();
    const ids = tasks.map(t => t.id);
    tasks = [];
    renderAll();
    showToast('Todas as tarefas da sala foram limpas.', 'info');
    try {
        await Promise.all(ids.map(id => removeTaskFromCloud(id)));
    } catch (e) {}
}

/**************************************************************
 * 9. POMODORO TIMER
 **************************************************************/
function togglePomodoroMode() {
    if (pomoIsRunning) resetPomodoro();
    if (pomoMode === 'focus') {
        pomoMode = 'break';
        pomoTimeLeft = 5 * 60;
        document.getElementById('pomoModeText').textContent = 'Pausa';
        document.getElementById('pomoModeBtn').className = 'text-xs font-semibold px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition flex items-center gap-1.5';
        document.getElementById('pomoIcon').className = 'fa-solid fa-mug-hot';
    } else {
        pomoMode = 'focus';
        pomoTimeLeft = 25 * 60;
        document.getElementById('pomoModeText').textContent = 'Foco';
        document.getElementById('pomoModeBtn').className = 'text-xs font-semibold px-2 py-1 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 transition flex items-center gap-1.5';
        document.getElementById('pomoIcon').className = 'fa-solid fa-brain';
    }
    updatePomodoroDisplay();
}

function startPausePomodoro() {
    const playBtn = document.getElementById('pomoPlayBtn');
    if (pomoIsRunning) {
        clearInterval(pomoInterval);
        pomoIsRunning = false;
        playBtn.innerHTML = `<i class="fa-solid fa-play text-xs"></i>`;
        playBtn.className = 'w-7 h-7 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition shadow-sm';
    } else {
        pomoIsRunning = true;
        playBtn.innerHTML = `<i class="fa-solid fa-pause text-xs"></i>`;
        playBtn.className = 'w-7 h-7 rounded-lg bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center transition shadow-sm';
        pomoInterval = setInterval(() => {
            if (pomoTimeLeft > 0) {
                pomoTimeLeft--;
                updatePomodoroDisplay();
            } else {
                clearInterval(pomoInterval);
                pomoIsRunning = false;
                playBtn.innerHTML = `<i class="fa-solid fa-play text-xs"></i>`;
                playBtn.className = 'w-7 h-7 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition shadow-sm';
                showToast(pomoMode === 'focus' ? 'Tempo de foco concluído! Hora de uma pausa.' : 'Pausa concluída! Vamos voltar ao foco.', 'success');
            }
        }, 1000);
    }
}

function resetPomodoro() {
    if (pomoInterval) clearInterval(pomoInterval);
    pomoIsRunning = false;
    pomoTimeLeft = pomoMode === 'focus' ? 25 * 60 : 5 * 60;
    const playBtn = document.getElementById('pomoPlayBtn');
    playBtn.innerHTML = `<i class="fa-solid fa-play text-xs"></i>`;
    playBtn.className = 'w-7 h-7 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition shadow-sm';
    updatePomodoroDisplay();
}

function updatePomodoroDisplay() {
    const mins = Math.floor(pomoTimeLeft / 60);
    const secs = pomoTimeLeft % 60;
    const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    document.getElementById('pomoTimerDisplay').textContent = display;
    document.title = `(${display}) TaskFlow Pro`;
}

/*************************************************************************
 * 12. RECOLHIMENTO PADRÃO AO CABEÇALHO, SALAS POR MEMBRO, ROTEAMENTO
 *     AUTOMÁTICO E PERMISSÕES DE ATRIBUIÇÃO (ADMIN vs. MEMBRO)
 *************************************************************************/
const UNIFIED_TASKS_STORAGE_KEY = 'taskflow_pro_unified_tasks_v8';
const expandedTaskCardsSet = new Set(); // Vazio por padrão = todas as tarefas recolhidas ao cabeçalho!

function toggleTaskCardCollapse(taskId) {
    if (expandedTaskCardsSet.has(taskId)) {
        expandedTaskCardsSet.delete(taskId);
    } else {
        expandedTaskCardsSet.add(taskId);
    }
    renderAll();
}

function handleTaskHeaderClick(event, taskId) {
    if (event.target && ['SELECT', 'BUTTON', 'INPUT', 'OPTION'].includes(event.target.tagName)) {
        return;
    }
    toggleTaskCardCollapse(taskId);
}

const expandedGanttMacroSet = new Set(); // Vazio por padrão = Tarefas Macro recolhidas no Gantt!

function toggleGanttMacroTask(macroKey) {
    if (expandedGanttMacroSet.has(macroKey)) {
        expandedGanttMacroSet.delete(macroKey);
    } else {
        expandedGanttMacroSet.add(macroKey);
    }
    renderAll();
}

function expandOrCollapseAllTasks(expand) {
    if (!expand) {
        expandedTaskCardsSet.clear();
        expandedGanttMacroSet.clear();
    } else {
        const visible = getFilteredTasks();
        visible.forEach(t => {
            expandedTaskCardsSet.add(t.id);
            expandedGanttMacroSet.add(t.id);
        });
    }
    renderAll();
}

function normalizeIdentityStr(val) {
    return String(val || '').trim().toLowerCase();
}

function doesAssigneeMatchUser(assigneeValue, userObjOrName, fallbackLogin = '') {
    const target = normalizeIdentityStr(assigneeValue).replace(/^@/, '');
    if (!target) return false;

    if (typeof userObjOrName === 'object' && userObjOrName !== null) {
        const uLogin = normalizeIdentityStr(userObjOrName.id).replace(/^@/, '');
        const uName  = normalizeIdentityStr(userObjOrName.fullName);
        return (uLogin && target === uLogin) || (uName && target === uName);
    }

    const cName  = normalizeIdentityStr(userObjOrName).replace(/^@/, '');
    const cLogin = normalizeIdentityStr(fallbackLogin).replace(/^@/, '');
    return (cName && target === cName) || (cLogin && target === cLogin);
}

function getMemberPersonalRoomCode(loginOrName) {
    const clean = normalizeIdentityStr(loginOrName).replace(/[^a-z0-9._-]/gi, '') || 'membro';
    return `sala_${clean}`;
}

function getRoomOwnerDescriptor(roomCode = currentWorkspace) {
    const code = normalizeIdentityStr(roomCode);
    if (!code || code === 'geral' || code === 'projetos') return null;

    const roomsMap = getLocalRoomConfigs();
    const cfg = roomsMap[code];
    if (cfg && (cfg.ownerLogin || cfg.ownerName)) {
        const matchedUser = registeredUsersCache.find(
            u => normalizeIdentityStr(u.id) === normalizeIdentityStr(cfg.ownerLogin)
        );
        return matchedUser || { id: cfg.ownerLogin || code, fullName: cfg.ownerName || cfg.roomName };
    }

    if (code.startsWith('sala_')) {
        const rawKey = code.replace(/^sala_/, '');
        const matchedUser = registeredUsersCache.find(
            u => normalizeIdentityStr(u.id).replace(/[^a-z0-9._-]/gi, '') === rawKey ||
                 normalizeIdentityStr(u.fullName).replace(/[^a-z0-9._-]/gi, '') === rawKey
        );
        if (matchedUser) return matchedUser;
        return { id: rawKey, fullName: rawKey.toUpperCase() };
    }

    return null;
}

function doesTaskAppearInRoom(task, roomCode = currentWorkspace) {
    const owner = getRoomOwnerDescriptor(roomCode);
    if (!owner) {
        return true; // Sala Geral (Admin): exibe todas as tarefas
    }
    if (doesAssigneeMatchUser(task.author, owner)) return true;

    if (Array.isArray(task.subtasks)) {
        for (const sub of task.subtasks) {
            if (doesAssigneeMatchUser(sub.assignee, owner)) return true;
            if (Array.isArray(sub.innerTasks)) {
                if (sub.innerTasks.some(it => doesAssigneeMatchUser(it.assignee, owner))) {
                    return true;
                }
            }
        }
    }
    return false;
}

function syncMemberPersonalRooms() {
    const map = getLocalRoomConfigs();

    map['geral'] = {
        id: 'geral',
        roomName: 'SALA GERAL (TODOS OS PROJETOS)',
        isGeneralRoom: true,
        createdBy: 'Administrador',
        createdAt: map['geral']?.createdAt || Date.now()
    };

    registeredUsersCache
        .filter(u => u.status !== 'pending')
        .forEach(u => {
            const rCode = getMemberPersonalRoomCode(u.id);
            map[rCode] = {
                id: rCode,
                roomName: `SALA: ${(u.fullName || u.id).toUpperCase()}`,
                ownerLogin: String(u.id).toLowerCase(),
                ownerName: u.fullName || u.id,
                isMemberRoom: true,
                createdBy: u.fullName || u.id,
                createdAt: map[rCode]?.createdAt || Date.now()
            };
        });

    localStorage.setItem(LOCAL_ROOM_CONFIG_KEY, JSON.stringify(map));
}

loadTasksFromLocalCache = function() {
    try {
        let unified = [];
        const rawUnified = localStorage.getItem(UNIFIED_TASKS_STORAGE_KEY);
        if (rawUnified) {
            unified = JSON.parse(rawUnified) || [];
        }

        const seenIds = new Set(unified.map(t => t.id));
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(STORAGE_KEY_PREFIX)) {
                try {
                    const oldArr = JSON.parse(localStorage.getItem(k) || '[]');
                    if (Array.isArray(oldArr)) {
                        oldArr.forEach(t => {
                            if (t && t.id && !seenIds.has(t.id)) {
                                unified.push(t);
                                seenIds.add(t.id);
                            }
                        });
                    }
                } catch (e) {}
            }
        }

        tasks = unified;
        localStorage.setItem(UNIFIED_TASKS_STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
        tasks = [];
    }
};

saveLocalCacheOnly = function() {
    try {
        localStorage.setItem(UNIFIED_TASKS_STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {}
};

fetchAllRoomsFromCloud = async function() {
    syncMemberPersonalRooms();
    const roomsMap = getLocalRoomConfigs();
    const list = Object.values(roomsMap).sort((a, b) => {
        if (a.isGeneralRoom) return -1;
        if (b.isGeneralRoom) return 1;
        return String(a.roomName || a.id).localeCompare(String(b.roomName || b.id), 'pt-BR');
    });
    availableRoomsCache = list;
    return list;
};

loadExistingRoomsDropdown = async function(showFeedback = false) {
    await fetchAllRoomsFromCloud();
    const selectEl = document.getElementById('authRoomSelect');
    const userSelectEl = document.getElementById('authUserSelect');
    const hintEl = document.getElementById('roomsCountHint');
    if (!selectEl) return;

    const selectedLogin = normalizeIdentityStr(userSelectEl?.value || currentUserLogin);
    const selectedUser = registeredUsersCache.find(u => normalizeIdentityStr(u.id) === selectedLogin);
    const isSelectedAdmin = selectedUser && selectedUser.role === 'admin' && selectedUser.status !== 'pending';

    let visibleRooms = availableRoomsCache;
    if (selectedUser && !isSelectedAdmin) {
        const myRoomCode = getMemberPersonalRoomCode(selectedUser.id);
        visibleRooms = availableRoomsCache.filter(r => normalizeIdentityStr(r.id) === myRoomCode);
    }

    selectEl.innerHTML = visibleRooms.map(r => {
        const code = String(r.id).toLowerCase();
        const label = String(r.roomName || r.id).toUpperCase();
        return `<option value="${escapeHtml(code)}">📂 ${escapeHtml(label)}</option>`;
    }).join('');

    if (selectedUser && !isSelectedAdmin) {
        selectEl.value = getMemberPersonalRoomCode(selectedUser.id);
        if (hintEl) {
            hintEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-semibold"><i class="fa-solid fa-door-open mr-1"></i>Sala exclusiva do membro <strong>${escapeHtml(selectedUser.fullName || selectedUser.id)}</strong> (exibe todas as tarefas e subtarefas atribuídas a você).</span>`;
        }
    } else {
        if (currentWorkspace && visibleRooms.some(r => normalizeIdentityStr(r.id) === normalizeIdentityStr(currentWorkspace))) {
            selectEl.value = normalizeIdentityStr(currentWorkspace);
        } else if (selectedUser) {
            selectEl.value = 'geral';
        }
        if (hintEl) {
            hintEl.textContent = 'Como Administrador, você pode acessar a Sala Geral ou inspecionar a sala individual de qualquer membro.';
        }
    }
};

const _origHandleUserSelectChange = handleUserSelectChange;
handleUserSelectChange = function() {
    _origHandleUserSelectChange();
    loadExistingRoomsDropdown(false);
};

function handleQuickRoomSwitch(newRoomCode) {
    if (!newRoomCode) return;
    currentWorkspace = newRoomCode;
    try {
        const rawSession = localStorage.getItem(SESSION_KEY);
        if (rawSession) {
            const sess = JSON.parse(rawSession);
            sess.room = currentWorkspace;
            localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
        }
    } catch (e) {}
    renderAdminQuickRoomSwitcher();
    renderAll();
    updateCloudStatusUI('synced');
    const owner = getRoomOwnerDescriptor(currentWorkspace);
    showToast(owner ? `Visualizando a Sala de ${owner.fullName || owner.id}` : 'Visualizando a Sala Geral (Todos os Projetos)', 'info');
}

function renderAdminQuickRoomSwitcher() {
    syncMemberPersonalRooms();
    const badgeEl = document.getElementById('headerRoomBadge');
    const menuRoomEl = document.getElementById('menuRoomName');
    const quickSelect = document.getElementById('headerQuickRoomSelect');

    if (isAuthenticated && !isCurrentUserAdmin && currentUserLogin) {
        const expectedRoom = getMemberPersonalRoomCode(currentUserLogin);
        if (currentWorkspace !== expectedRoom) {
            currentWorkspace = expectedRoom;
        }
    }

    const owner = getRoomOwnerDescriptor(currentWorkspace);
    const displayRoomTitle = owner ? `SALA: ${(owner.fullName || owner.id).toUpperCase()}` : 'SALA GERAL';

    if (badgeEl) badgeEl.textContent = displayRoomTitle;
    if (menuRoomEl) menuRoomEl.textContent = displayRoomTitle;

    const roomBtn = document.getElementById('headerRoomBtn');
    const adminRoomWrapper = document.getElementById('headerAdminRoomWrapper');

    if (quickSelect) {
        if (isAuthenticated && isCurrentUserAdmin) {
            const roomsMap = getLocalRoomConfigs();
            const allRooms = Object.values(roomsMap).sort((a, b) => {
                if (a.isGeneralRoom) return -1;
                if (b.isGeneralRoom) return 1;
                return String(a.roomName || a.id).localeCompare(String(b.roomName || b.id), 'pt-BR');
            });
            quickSelect.innerHTML = allRooms.map(r => {
                const sel = normalizeIdentityStr(r.id) === normalizeIdentityStr(currentWorkspace) ? 'selected' : '';
                const cleanLabel = r.isGeneralRoom ? 'SALA GERAL (TODAS)' : String(r.roomName || r.id);
                return `<option value="${escapeHtml(r.id)}" ${sel}>${escapeHtml(cleanLabel)}</option>`;
            }).join('');
            if (adminRoomWrapper) {
                adminRoomWrapper.classList.remove('hidden');
                adminRoomWrapper.classList.add('inline-flex');
            }
            if (roomBtn) roomBtn.classList.add('hidden');
        } else {
            if (adminRoomWrapper) {
                adminRoomWrapper.classList.add('hidden');
                adminRoomWrapper.classList.remove('inline-flex');
            }
            if (roomBtn) roomBtn.classList.remove('hidden');
        }
    }
}

populateAuthorsDatalist = function() {
    const dl = document.getElementById('registeredUsersDatalist');
    const allMembers = getAllTeamMembersList();
    const allowedList = isCurrentUserAdmin
        ? allMembers
        : allMembers.filter(m => doesAssigneeMatchUser(m.name, currentAuthor, currentUserLogin));

    if (dl) {
        dl.innerHTML = allowedList
            .map(m => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.subLabel)}</option>`)
            .join('');
    }

    const memberFilterEl = document.getElementById('memberFilter');
    if (memberFilterEl) {
        const prev = memberFilterEl.value || 'all';
        memberFilterEl.innerHTML = `<option value="all">👥 Todos da sala</option>` +
            allMembers.map(m => `<option value="${escapeHtml(m.name.toLowerCase())}">👤 ${escapeHtml(m.name)}</option>`).join('');
        if ([...memberFilterEl.options].some(o => o.value === prev)) {
            memberFilterEl.value = prev;
        }
    }
    renderAdminQuickRoomSwitcher();
};

updateDashboardMetrics = function() {
    const roomTasks = tasks.filter(t => doesTaskAppearInRoom(t, currentWorkspace));
    const total = roomTasks.length;
    const completed = roomTasks.filter(t => t.status === 'done').length;
    const todoCount = roomTasks.filter(t => t.status === 'todo').length;
    const inProgressCount = roomTasks.filter(t => t.status === 'in_progress').length;
    const todayStr = getLocalDateStr(0);

    const todayPending = roomTasks.filter(t => t.status !== 'done' && t.dueDate === todayStr).length;
    const overdueCount = roomTasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < todayStr).length;

    let totalSub = 0;
    let doneSub = 0;
    roomTasks.forEach(t => {
        if (t.subtasks && t.subtasks.length > 0) {
            totalSub += t.subtasks.length;
            doneSub += t.subtasks.filter(s => s.completed).length;
        }
    });

    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statCompletedLabel').textContent = `${completed} concluída${completed === 1 ? '' : 's'}`;
    const todoEl = document.getElementById('statStatusTodo');
    if (todoEl) todoEl.textContent = todoCount;
    const inProgEl = document.getElementById('statStatusInProgress');
    if (inProgEl) inProgEl.textContent = inProgressCount;
    document.getElementById('statToday').textContent = todayPending;
    document.getElementById('statOverdue').textContent = overdueCount;
    document.getElementById('statProgressPercent').textContent = `${percent}%`;
    document.getElementById('statProgressBar').style.width = `${percent}%`;
    document.getElementById('statSubtasksCounter').textContent = `${doneSub}/${totalSub} subtarefas`;
};

const _origGetFilteredTasks = getFilteredTasks;
getFilteredTasks = function() {
    const baseFiltered = _origGetFilteredTasks();
    return baseFiltered.filter(t => doesTaskAppearInRoom(t, currentWorkspace));
};

updateCardTaskAssignee = async function(taskId, newAssignee) {
    if (!isCurrentUserAdmin) {
        showToast('Apenas o Administrador pode definir ou alterar o responsável principal pela tarefa.', 'error');
        renderAll();
        return;
    }
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    task.author = (newAssignee || '').trim();
    task.updatedAt = Date.now();
    saveLocalCacheOnly();
    renderAll();
    showToast(
        task.author
            ? `Responsável pela tarefa definido como "${task.author}" (visível na sala do membro).`
            : 'Responsável principal removido.',
        'success'
    );
};

updateCardSubtaskAssignee = async function(taskId, subIdx, newAssignee) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.subtasks || !task.subtasks[subIdx]) return;
    ensureSubtaskStructure(task.subtasks);

    const cleanTarget = (newAssignee || '').trim();
    const currentSubAssignee = (task.subtasks[subIdx].assignee || '').trim();
    const fallbackOwner = (task.author || '').trim();
    const previousOwner = currentSubAssignee || fallbackOwner;
    const isTaskOwner = doesAssigneeMatchUser(task.author, currentAuthor, currentUserLogin);
    const isSubOwner = doesAssigneeMatchUser(currentSubAssignee, currentAuthor, currentUserLogin);

    if (!isCurrentUserAdmin) {
        // Membro só pode alterar se for o responsável pela tarefa ou responsável pela subtarefa
        if (!isTaskOwner && !isSubOwner && currentSubAssignee) {
            showToast('Apenas o Administrador ou o responsável pela tarefa/subtarefa pode alterar esta atribuição.', 'error');
            renderAll();
            return;
        }
        task.subtasks[subIdx].assignee = cleanTarget;
    } else {
        task.subtasks[subIdx].assignee = cleanTarget;
    }

    // Se a subtarefa foi designada para outro membro da equipe, o tempo dela é distribuído entre as subtarefas restantes que ainda não foram concluídas!
    const redist = redistributeReassignedSubtaskHours(task.subtasks, subIdx, previousOwner, cleanTarget, fallbackOwner);

    task.updatedAt = Date.now();
    saveLocalCacheOnly();
    renderAll();
    await upsertTaskToCloud(task);

    if (redist.redistributed) {
        showToast(
            `Subtarefa #${subIdx + 1} designada a "${cleanTarget}". O tempo dela (${redist.freedHours}h) foi distribuído (+${redist.extraHoursPerRemaining}h cada) entre as ${redist.remainingCount} subtarefa(s) pendente(s) restante(s)!`,
            'success'
        );
    } else {
        showToast(
            task.subtasks[subIdx].assignee
                ? `Subtarefa #${subIdx + 1} atribuída a "${task.subtasks[subIdx].assignee}" (visível na sala do membro).`
                : `Atribuição removida da subtarefa #${subIdx + 1}.`,
            'success'
        );
    }
};

const _origOpenTaskModal = openTaskModal;
openTaskModal = function(taskId = null) {
    _origOpenTaskModal(taskId);
    const authorInp = document.getElementById('taskAuthorInput');
    const subAssigneeInp = document.getElementById('newSubtaskAssigneeInput');

    if (!isCurrentUserAdmin) {
        if (authorInp) {
            if (!taskId) authorInp.value = currentAuthor || '';
            authorInp.readOnly = true;
            authorInp.title = 'Apenas o Administrador pode atribuir tarefas a outros membros';
            authorInp.classList.add('opacity-70', 'cursor-not-allowed');
        }
        if (subAssigneeInp) {
            subAssigneeInp.value = currentAuthor || '';
            subAssigneeInp.readOnly = true;
            subAssigneeInp.title = 'Membros só podem atribuir subtarefas a si mesmos';
        }
    } else {
        if (authorInp) {
            authorInp.readOnly = false;
            authorInp.title = 'Selecione ou digite o membro responsável pela tarefa';
            authorInp.classList.remove('opacity-70', 'cursor-not-allowed');
        }
        if (subAssigneeInp) {
            subAssigneeInp.readOnly = false;
            subAssigneeInp.title = 'Atribuir subtarefa a qualquer membro da equipe';
        }
    }
};

const _origUpdateModalSubtaskAssignee = updateModalSubtaskAssignee;
updateModalSubtaskAssignee = function(subIdx, newAssignee) {
    const cleanVal = (newAssignee || '').trim();
    if (!isCurrentUserAdmin && cleanVal && !doesAssigneeMatchUser(cleanVal, currentAuthor, currentUserLogin)) {
        showToast(`Membros só podem atribuir subtarefas a si mesmos (${currentAuthor}).`, 'error');
        modalSubtasks[subIdx].assignee = currentAuthor;
        renderModalSubtasks();
        return;
    }
    _origUpdateModalSubtaskAssignee(subIdx, isCurrentUserAdmin ? cleanVal : (cleanVal ? currentAuthor : ''));
};

const _origUpdateInnerTaskAssignee = updateInnerTaskAssignee;
updateInnerTaskAssignee = function(subIdx, innerIdx, newAssignee) {
    const cleanVal = (newAssignee || '').trim();
    if (!isCurrentUserAdmin && cleanVal && !doesAssigneeMatchUser(cleanVal, currentAuthor, currentUserLogin)) {
        showToast(`Membros só podem atribuir etapas internas a si mesmos (${currentAuthor}).`, 'error');
        modalSubtasks[subIdx].innerTasks[innerIdx].assignee = currentAuthor;
        renderModalSubtasks();
        return;
    }
    _origUpdateInnerTaskAssignee(subIdx, innerIdx, isCurrentUserAdmin ? cleanVal : (cleanVal ? currentAuthor : ''));
};

const _origUpdateExcelPreviewItemAssignee = updateExcelPreviewItemAssignee;
updateExcelPreviewItemAssignee = function(idx, newAssignee) {
    const cleanVal = (newAssignee || '').trim();
    if (!isCurrentUserAdmin && cleanVal && !doesAssigneeMatchUser(cleanVal, currentAuthor, currentUserLogin)) {
        showToast(`Membros só podem atribuir subtarefas a si mesmos (${currentAuthor}).`, 'error');
        parsedExcelOrder.items[idx].assignee = currentAuthor;
        renderExcelPreviewTable();
        return;
    }
    _origUpdateExcelPreviewItemAssignee(idx, isCurrentUserAdmin ? cleanVal : (cleanVal ? currentAuthor : ''));
};


/*************************************************************************
 * 13. REORDENAÇÃO DE TAREFAS E SUBTAREFAS, SELEÇÃO DE MEMBROS AO CLICAR
 *     E PRESERVAÇÃO DE ROLAGEM (SEM PULAR PARA O INÍCIO AO FINALIZAR)
 *************************************************************************/
function buildMemberSelectOptionsHTML(selectedVal = '', allowAllMembers = true, placeholderText = '👤 Sem responsável') {
    const allMembers = getAllTeamMembersList();
    const list = allowAllMembers
        ? allMembers
        : allMembers.filter(m => doesAssigneeMatchUser(m.name, currentAuthor, currentUserLogin));

    const cleanSel = String(selectedVal || '').trim();
    let foundSel = false;

    const opts = list.map(m => {
        const isSel = cleanSel && normalizeIdentityStr(m.name) === normalizeIdentityStr(cleanSel);
        if (isSel) foundSel = true;
        return `<option value="${escapeHtml(m.name)}" ${isSel ? 'selected' : ''}>👤 ${escapeHtml(m.name)}</option>`;
    });

    if (cleanSel && !foundSel) {
        opts.unshift(`<option value="${escapeHtml(cleanSel)}" selected>👤 ${escapeHtml(cleanSel)}</option>`);
    }

    return `<option value="" ${!cleanSel ? 'selected' : ''}>${escapeHtml(placeholderText)}</option>` + opts.join('');
}

function populateStaticMemberSelects() {
    const taskAuthorSel = document.getElementById('taskAuthorInput');
    if (taskAuthorSel) {
        const curVal = taskAuthorSel.value || currentAuthor || '';
        taskAuthorSel.innerHTML = buildMemberSelectOptionsHTML(curVal, isCurrentUserAdmin, '👤 Sem responsável definido');
        taskAuthorSel.value = curVal;
        taskAuthorSel.disabled = !isCurrentUserAdmin;
    }

    const newSubAssSel = document.getElementById('newSubtaskAssigneeInput');
    if (newSubAssSel) {
        const curVal = newSubAssSel.value || currentAuthor || '';
        newSubAssSel.innerHTML = buildMemberSelectOptionsHTML(curVal, isCurrentUserAdmin, '👤 Sem membro atribuído');
        newSubAssSel.value = curVal;
    }

    const importAuthorSel = document.getElementById('importDefaultAuthor');
    if (importAuthorSel) {
        const curVal = importAuthorSel.value || currentAuthor || '';
        importAuthorSel.innerHTML = buildMemberSelectOptionsHTML(curVal, isCurrentUserAdmin, '👤 Sem responsável');
        importAuthorSel.value = curVal;
        importAuthorSel.disabled = !isCurrentUserAdmin;
    }
}

function handleImportDefaultAuthorChange(newAuthorVal) {
    if (!parsedExcelOrder || !Array.isArray(parsedExcelOrder.items)) return;
    parsedExcelOrder.items.forEach(it => {
        it.assignee = newAuthorVal || '';
    });
    renderExcelPreviewTable();
}

const _prevPopulateAuthorsDatalist = populateAuthorsDatalist;
populateAuthorsDatalist = function() {
    _prevPopulateAuthorsDatalist();
    populateStaticMemberSelects();
};

const _prevOpenTaskModalV12 = openTaskModal;
openTaskModal = function(taskId = null) {
    populateStaticMemberSelects();
    _prevOpenTaskModalV12(taskId);
    const task = taskId ? tasks.find(t => t.id === taskId) : null;
    const targetAuthor = task ? (task.author || '') : (currentAuthor || '');
    const taskAuthorSel = document.getElementById('taskAuthorInput');
    if (taskAuthorSel) {
        taskAuthorSel.innerHTML = buildMemberSelectOptionsHTML(targetAuthor, isCurrentUserAdmin, '👤 Sem responsável definido');
        taskAuthorSel.value = targetAuthor;
        taskAuthorSel.disabled = !isCurrentUserAdmin;
    }
    const newSubAssSel = document.getElementById('newSubtaskAssigneeInput');
    if (newSubAssSel) {
        const defaultSubAss = targetAuthor || currentAuthor || '';
        newSubAssSel.innerHTML = buildMemberSelectOptionsHTML(defaultSubAss, isCurrentUserAdmin || doesAssigneeMatchUser(targetAuthor, currentAuthor, currentUserLogin), '👤 Sem membro atribuído');
        newSubAssSel.value = defaultSubAss;
    }
};

const _prevOpenExcelImportModal = openExcelImportModal;
openExcelImportModal = function() {
    populateStaticMemberSelects();
    _prevOpenExcelImportModal();
    const importAuthorSel = document.getElementById('importDefaultAuthor');
    if (importAuthorSel) {
        importAuthorSel.innerHTML = buildMemberSelectOptionsHTML(currentAuthor || '', isCurrentUserAdmin, '👤 Sem responsável');
        importAuthorSel.value = currentAuthor || '';
    }
};

// Reordenação manual de Tarefas (Botões ▲ / ▼)
async function moveTaskOrder(taskId, delta) {
    if (!hasUserPermission('canEdit') && !hasUserPermission('canChangeStatus')) {
        showToast('Sem permissão para reordenar tarefas.', 'error');
        return;
    }
    const sortSelect = document.getElementById('sortBySelect');
    if (sortSelect && sortSelect.value !== 'manual') {
        sortSelect.value = 'manual';
    }

    // Garante ordem sequencial base antes da troca
    const visible = getFilteredTasks();
    const vIdx = visible.findIndex(t => t.id === taskId);
    if (vIdx === -1) return;
    const targetVIdx = vIdx + delta;
    if (targetVIdx < 0 || targetVIdx >= visible.length) return;

    const taskA = visible[vIdx];
    const taskB = visible[targetVIdx];

    const idxA = tasks.findIndex(t => t.id === taskA.id);
    const idxB = tasks.findIndex(t => t.id === taskB.id);
    if (idxA === -1 || idxB === -1) return;

    // Troca a posição no array principal e atualiza manualOrder
    const temp = tasks[idxA];
    tasks[idxA] = tasks[idxB];
    tasks[idxB] = temp;

    tasks.forEach((t, i) => { t.manualOrder = i; });
    saveLocalCacheOnly();
    renderAll();
}

// Reordenação de Tarefas por Drag-and-Drop diretamente sobre outro cartão
function handleCardDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('ring-2', 'ring-indigo-500/60');
}

function handleCardDragLeave(e) {
    e.currentTarget.classList.remove('ring-2', 'ring-indigo-500/60');
}

async function handleCardDropReorder(e, targetTaskId) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('ring-2', 'ring-indigo-500/60');

    const sourceTaskId = draggedTaskId || e.dataTransfer.getData('text/plain');
    if (!sourceTaskId || sourceTaskId === targetTaskId) return;

    const srcIdx = tasks.findIndex(t => t.id === sourceTaskId);
    const tgtIdx = tasks.findIndex(t => t.id === targetTaskId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    const sortSelect = document.getElementById('sortBySelect');
    if (sortSelect && sortSelect.value !== 'manual') {
        sortSelect.value = 'manual';
    }

    const [movedTask] = tasks.splice(srcIdx, 1);
    tasks.splice(tgtIdx, 0, movedTask);
    tasks.forEach((t, i) => { t.manualOrder = i; });

    saveLocalCacheOnly();
    renderAll();
    showToast('Posição da tarefa reordenada!', 'info');
}

// Reordenação de Subtarefas diretamente no Cartão da Tarefa (▲ / ▼)
async function moveCardSubtaskOrder(taskId, subIdx, delta) {
    if (!hasUserPermission('canEdit') && !hasUserPermission('canManageSubtasks')) {
        showToast('Sem permissão para reordenar subtarefas.', 'error');
        return;
    }
    const task = tasks.find(t => t.id === taskId);
    if (!task || !Array.isArray(task.subtasks)) return;

    const newIdx = subIdx + delta;
    if (newIdx < 0 || newIdx >= task.subtasks.length) return;

    // Preserva estado expandido das tarefas internas se houver troca
    const keyA = `${taskId}::${subIdx}`;
    const keyB = `${taskId}::${newIdx}`;
    const aExp = expandedCardSubtasksSet.has(keyA);
    const bExp = expandedCardSubtasksSet.has(keyB);
    expandedCardSubtasksSet.delete(keyA);
    expandedCardSubtasksSet.delete(keyB);
    if (aExp) expandedCardSubtasksSet.add(keyB);
    if (bExp) expandedCardSubtasksSet.add(keyA);

    const temp = task.subtasks[subIdx];
    task.subtasks[subIdx] = task.subtasks[newIdx];
    task.subtasks[newIdx] = temp;
    task.subtasks.forEach((s, idx) => { s.originalOrder = idx; });

    task.updatedAt = Date.now();
    saveLocalCacheOnly();
    renderAll();
}

// Reordenação de Subtarefas dentro do Modal de Criação/Edição (▲ / ▼)
function moveModalSubtaskOrder(subIdx, delta) {
    ensureSubtaskStructure(modalSubtasks);
    const newIdx = subIdx + delta;
    if (newIdx < 0 || newIdx >= modalSubtasks.length) return;

    if (activeExpandedSubtaskIdx === subIdx) {
        activeExpandedSubtaskIdx = newIdx;
    } else if (activeExpandedSubtaskIdx === newIdx) {
        activeExpandedSubtaskIdx = subIdx;
    }

    const temp = modalSubtasks[subIdx];
    modalSubtasks[subIdx] = modalSubtasks[newIdx];
    modalSubtasks[newIdx] = temp;
    renderModalSubtasks();
}

// Reordenação de Tarefas Internas dentro de uma Subtarefa no Modal (▲ / ▼)
function moveModalInnerTaskOrder(subIdx, innerIdx, delta) {
    ensureSubtaskStructure(modalSubtasks);
    const sub = modalSubtasks[subIdx];
    if (!sub || !Array.isArray(sub.innerTasks)) return;
    const newIdx = innerIdx + delta;
    if (newIdx < 0 || newIdx >= sub.innerTasks.length) return;

    const temp = sub.innerTasks[innerIdx];
    sub.innerTasks[innerIdx] = sub.innerTasks[newIdx];
    sub.innerTasks[newIdx] = temp;
    renderModalSubtasks();
}

// Reordenação de Itens na Tabela de Pré-Visualização do Excel (▲ / ▼)
function moveExcelPreviewItemOrder(idx, delta) {
    if (!parsedExcelOrder || !Array.isArray(parsedExcelOrder.items)) return;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= parsedExcelOrder.items.length) return;

    const temp = parsedExcelOrder.items[idx];
    parsedExcelOrder.items[idx] = parsedExcelOrder.items[newIdx];
    parsedExcelOrder.items[newIdx] = temp;
    renderExcelPreviewTable();
}

// Mapa global de posições de rolagem de todos os containers internos (ex: lista de subtarefas dentro de cada cartão)
const savedContainerScrollMap = new Map();

function recordContainerScroll(el) {
    if (!el) return;
    const key = el.getAttribute('data-scroll-id') || el.id;
    if (key) {
        savedContainerScrollMap.set(key, {
            top: el.scrollTop,
            left: el.scrollLeft
        });
    }
}

function captureAllScrollPositions() {
    document.querySelectorAll('[data-scroll-id]').forEach(el => {
        const key = el.getAttribute('data-scroll-id');
        if (key) {
            savedContainerScrollMap.set(key, {
                top: el.scrollTop,
                left: el.scrollLeft
            });
        }
    });
}

function restoreAllScrollPositions(winX, winY) {
    document.querySelectorAll('[data-scroll-id]').forEach(el => {
        const key = el.getAttribute('data-scroll-id');
        if (key && savedContainerScrollMap.has(key)) {
            const pos = savedContainerScrollMap.get(key);
            el.scrollTop = pos.top;
            el.scrollLeft = pos.left;
        }
    });
    if (typeof winY === 'number') {
        window.scrollTo(winX || 0, winY);
    }
}

// Preservação completa da barra de rolagem interna dos cartões e da página em qualquer ação
const _origRenderAllV12 = renderAll;
renderAll = function() {
    const savedWindowScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const savedWindowScrollX = window.scrollX || document.documentElement.scrollLeft || 0;
    captureAllScrollPositions();

    _origRenderAllV12();

    // Restaura imediatamente no mesmo frame (zero piscada) e confirma no próximo frame
    restoreAllScrollPositions(savedWindowScrollX, savedWindowScrollY);
    requestAnimationFrame(() => {
        restoreAllScrollPositions(savedWindowScrollX, savedWindowScrollY);
    });
};

const _origRenderModalSubtasksV12 = renderModalSubtasks;
renderModalSubtasks = function() {
    captureAllScrollPositions();
    _origRenderModalSubtasksV12();
    restoreAllScrollPositions();
    requestAnimationFrame(() => {
        restoreAllScrollPositions();
    });
};

const _origRenderExcelPreviewTableV12 = renderExcelPreviewTable;
renderExcelPreviewTable = function() {
    captureAllScrollPositions();
    _origRenderExcelPreviewTableV12();
    restoreAllScrollPositions();
    requestAnimationFrame(() => {
        restoreAllScrollPositions();
    });
};


/*************************************************************************
 * 14. DESTAQUE VISUAL AO CLICAR NA TAREFA E CONFIRMAÇÃO POR SENHA
 *     PARA EXCLUSÃO DE TAREFA OU SALA
 *************************************************************************/
let activeHighlightedTaskId = null;
let pendingDeleteAction = null; // { type: 'task' | 'room' | 'clear_room', taskId?: string }

function collapseOtherTasksExcept(targetTaskId) {
    // Recolhe todas as outras tarefas abertas ao colocar destaque em uma nova tarefa
    Array.from(expandedTaskCardsSet).forEach(openId => {
        if (openId !== targetTaskId) {
            expandedTaskCardsSet.delete(openId);
        }
    });
}

function setActiveHighlightedTask(taskId, event) {
    if (!taskId) return;
    if (activeHighlightedTaskId !== taskId) {
        activeHighlightedTaskId = taskId;
        collapseOtherTasksExcept(taskId);
        renderAll();
    }
}

const _origToggleTaskCardCollapseV13 = toggleTaskCardCollapse;
toggleTaskCardCollapse = function(taskId) {
    const wasExpanded = expandedTaskCardsSet.has(taskId);
    activeHighlightedTaskId = taskId;
    collapseOtherTasksExcept(taskId);
    if (wasExpanded) {
        expandedTaskCardsSet.delete(taskId);
    } else {
        expandedTaskCardsSet.add(taskId);
    }
    renderAll();
};


// Fecha o destaque se o usuário clicar fora de qualquer cartão ou modal
document.addEventListener('click', function(e) {
    // Fecha os menus dropdowns do cabeçalho se clicar fora deles
    const profileMenu = document.getElementById('userProfileDropdownMenu');
    const backupMenu = document.getElementById('backupDropdownMenu');
    const layoutMenu = document.getElementById('layoutDropdownMenu');
    
    if (profileMenu && !e.target.closest('#userProfileDropdownWrapper')) {
        profileMenu.classList.add('hidden');
    }
    if (backupMenu && !e.target.closest('#backupDropdownWrapper')) {
        backupMenu.classList.add('hidden');
    }
    if (layoutMenu && !e.target.closest('#layoutDropdownWrapper')) {
        layoutMenu.classList.add('hidden');
    }

    if (!activeHighlightedTaskId) return;
    const insideCard = e.target.closest('[data-task-card-id]');
    const insideModal = e.target.closest('#taskModal, #deletePasswordModal, #roomAuthModal, #adminPanelModal, #userDirectoryModal, #excelImportModal, #jsonImportChoiceModal');
    if (!insideCard && !insideModal) {
        activeHighlightedTaskId = null;
        renderAll();
    }
});

function toggleUserProfileDropdown(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('userProfileDropdownMenu');
    if (menu) {
        menu.classList.toggle('hidden');
    }
    document.getElementById('backupDropdownMenu')?.classList.add('hidden');
    document.getElementById('layoutDropdownMenu')?.classList.add('hidden');
}

function toggleBackupDropdown(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('backupDropdownMenu');
    if (menu) {
        menu.classList.toggle('hidden');
    }
    document.getElementById('userProfileDropdownMenu')?.classList.add('hidden');
    document.getElementById('layoutDropdownMenu')?.classList.add('hidden');
}

function toggleLayoutDropdown(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('layoutDropdownMenu');
    if (menu) {
        menu.classList.toggle('hidden');
    }
    document.getElementById('userProfileDropdownMenu')?.classList.add('hidden');
    document.getElementById('backupDropdownMenu')?.classList.add('hidden');
}


function openDeletePasswordModal(actionObj) {
    pendingDeleteAction = actionObj;
    const modal = document.getElementById('deletePasswordModal');
    const titleEl = document.getElementById('deletePasswordModalTitle');
    const descEl = document.getElementById('deletePasswordModalDesc');
    const errEl = document.getElementById('deletePasswordErrorAlert');
    const inpEl = document.getElementById('deletePasswordConfirmInput');

    if (errEl) {
        errEl.classList.add('hidden');
        errEl.textContent = '';
    }
    if (inpEl) inpEl.value = '';

    if (actionObj.type === 'task') {
        const t = tasks.find(item => item.id === actionObj.taskId);
        const tTitle = t ? t.title : 'selecionada';
        if (titleEl) titleEl.textContent = 'Senha para Excluir Tarefa';
        if (descEl) {
            descEl.innerHTML = `Você está prestes a excluir permanentemente a tarefa <strong>"${escapeHtml(tTitle)}"</strong>.<br>Digite sua senha pessoal (ou senha de Administrador) para confirmar:`;
        }
    } else if (actionObj.type === 'room') {
        if (titleEl) titleEl.textContent = 'Senha para Excluir Sala';
        if (descEl) {
            descEl.innerHTML = `Você está prestes a excluir permanentemente a sala <strong>"${escapeHtml((currentWorkspace || '').toUpperCase())}"</strong>.<br>Digite sua senha de Administrador para confirmar:`;
        }
    } else if (actionObj.type === 'clear_room') {
        if (titleEl) titleEl.textContent = 'Senha para Limpar Tarefas da Sala';
        if (descEl) {
            descEl.innerHTML = `Você está prestes a apagar <strong>todas as tarefas</strong> da sala <strong>"${escapeHtml((currentWorkspace || '').toUpperCase())}"</strong>.<br>Digite sua senha de Administrador para confirmar:`;
        }
    }

    if (modal) modal.classList.remove('hidden');
    setTimeout(() => inpEl?.focus(), 50);
}

function closeDeletePasswordModal() {
    pendingDeleteAction = null;
    document.getElementById('deletePasswordModal')?.classList.add('hidden');
}

async function verifyUserOrAdminPassword(rawPassword) {
    if (!rawPassword) return false;
    await fetchAllUsersFromCloud();

    // 1. Verifica a senha do usuário atualmente logado
    if (currentUserLogin) {
        const me = registeredUsersCache.find(u => normalizeIdentityStr(u.id) === normalizeIdentityStr(currentUserLogin));
        if (me) {
            const myCandidateHash = await computeSha256Hex(`user::${ String(me.id).toLowerCase() }::${rawPassword}`);
            if (myCandidateHash === me.passwordHash) return true;
        }
    }

    // 2. Verifica se corresponde à senha de qualquer Administrador ativo
    const admins = registeredUsersCache.filter(u => u.role === 'admin' && u.status !== 'pending');
    for (const adm of admins) {
        const admHash = await computeSha256Hex(`user::${ String(adm.id).toLowerCase() }::${rawPassword}`);
        if (admHash === adm.passwordHash) return true;
    }

    return false;
}

async function handleConfirmDeleteWithPassword(event) {
    event.preventDefault();
    if (!pendingDeleteAction) {
        closeDeletePasswordModal();
        return;
    }

    const inpEl = document.getElementById('deletePasswordConfirmInput');
    const errEl = document.getElementById('deletePasswordErrorAlert');
    const rawPass = inpEl ? inpEl.value : '';

    const isValid = await verifyUserOrAdminPassword(rawPass);
    if (!isValid) {
        if (errEl) {
            errEl.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1"></i>Senha incorreta! Exclusão não autorizada.`;
            errEl.classList.remove('hidden');
        }
        showToast('Senha incorreta! A exclusão foi bloqueada.', 'error');
        return;
    }

    const action = pendingDeleteAction;
    closeDeletePasswordModal();

    if (action.type === 'task') {
        const taskId = action.taskId;
        tasks = tasks.filter(t => t.id !== taskId);
        if (activeHighlightedTaskId === taskId) activeHighlightedTaskId = null;
        expandedTaskCardsSet.delete(taskId);
        saveLocalCacheOnly();
        renderAll();
        await removeTaskFromCloud(taskId);
        showToast('Tarefa excluída com sucesso após confirmação de senha.', 'info');
    } else if (action.type === 'room') {
        const roomToDelete = currentWorkspace;
        const roomTasksToDelete = tasks.filter(t => doesTaskAppearInRoom(t, roomToDelete));
        const idsToRemove = new Set(roomTasksToDelete.map(t => t.id));

        tasks = tasks.filter(t => !idsToRemove.has(t.id));
        saveLocalCacheOnly();
        await deleteRoomConfigFromCloud(roomToDelete);
        closeAdminPanelModal();
        logoutSession();
        showToast(`Sala "${roomToDelete.toUpperCase()}" excluída após confirmação de senha.`, 'info');
    } else if (action.type === 'clear_room') {
        const roomTasksToClear = tasks.filter(t => doesTaskAppearInRoom(t, currentWorkspace));
        const idsToClear = new Set(roomTasksToClear.map(t => t.id));
        tasks = tasks.filter(t => !idsToClear.has(t.id));
        saveLocalCacheOnly();
        renderAll();
        showToast('Todas as tarefas da sala foram limpas após confirmação de senha.', 'info');
    }
}

// Sobrescreve deleteTask, adminDeleteEntireRoom e openClearConfirmModal para exigir senha
deleteTask = async function(taskId) {
    if (!hasUserPermission('canDelete')) {
        showToast('Você não possui permissão para excluir tarefas.', 'error');
        return;
    }
    openDeletePasswordModal({ type: 'task', taskId });
};

adminDeleteEntireRoom = async function() {
    if (!isCurrentUserAdmin) {
        showToast('Apenas usuários com conta de Administrador podem excluir a sala.', 'error');
        return;
    }
    if (currentWorkspace === 'geral') {
        showToast('A Sala Geral principal não pode ser excluída (use Limpar Tarefas se desejar esvaziá-la).', 'error');
        return;
    }
    openDeletePasswordModal({ type: 'room' });
};

openClearConfirmModal = function() {
    if (!isCurrentUserAdmin) {
        showToast('Apenas o Administrador pode limpar todas as tarefas da sala.', 'error');
        return;
    }
    openDeletePasswordModal({ type: 'clear_room' });
};

function renderSimplifiedListView(filteredTasks, containerEl) {
    const allowStatus = hasUserPermission('canChangeStatus');
    const allowSubtasks = hasUserPermission('canManageSubtasks');
    const allowEdit = hasUserPermission('canEdit');
    const allowDelete = hasUserPermission('canDelete');

    containerEl.innerHTML = `
        <div class="bg-white dark:bg-darkCard rounded-2xl border border-slate-200 dark:border-darkBorder shadow-sm overflow-hidden">
            <!-- Cabeçalho da Lista Simplificada -->
            <div class="hidden md:grid md:grid-cols-12 gap-3 px-4 py-2.5 bg-slate-100/90 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <div class="col-span-5 flex items-center gap-2">Pedido / Tarefa</div>
                <div class="col-span-2">Responsável</div>
                <div class="col-span-2">Prazo & Prioridade</div>
                <div class="col-span-1 text-center">Itens</div>
                <div class="col-span-2 text-right">Status & Ações</div>
            </div>

            <div class="divide-y divide-slate-200/80 dark:divide-slate-800">
                ${filteredTasks.map(task => {
                    const pri = PRIORITY_META[task.priority] || PRIORITY_META.media;
                    const dueStatus = getDueDateStatus(task.dueDate, task.status);
                    let dueTextClass = 'text-slate-500 dark:text-slate-400';
                    if (dueStatus === 'overdue') dueTextClass = 'text-rose-600 dark:text-rose-400 font-bold';
                    else if (dueStatus === 'today') dueTextClass = 'text-amber-600 dark:text-amber-400 font-bold';

                    const subtasks = task.subtasks || [];
                    const subDoneCount = subtasks.filter(s => s.completed).length;
                    const subPercent = subtasks.length > 0 ? Math.round((subDoneCount / subtasks.length) * 100) : 0;

                    const isHighlighted = activeHighlightedTaskId === task.id;
                    const isCardExpanded = expandedTaskCardsSet.has(task.id);
                    const isTaskOwner = doesAssigneeMatchUser(task.author, currentAuthor, currentUserLogin);
                    const canReassignAnySubtask = isCurrentUserAdmin || isTaskOwner;

                    return `
                        <div data-task-card-id="${task.id}" onclick="setActiveHighlightedTask('${task.id}', event)" class="transition ${
                            isHighlighted
                                ? 'bg-indigo-50/70 dark:bg-indigo-950/35 ring-1 ring-inset ring-indigo-500/50'
                                : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                        } ${task.status === 'done' && !isHighlighted ? 'opacity-65' : ''}">
                            
                            <!-- Linha Compacta Principal (Clique na tarefa macro expande/recolhe subtarefas) -->
                            <div onclick="handleTaskHeaderClick(event, '${task.id}')" class="grid grid-cols-1 md:grid-cols-12 gap-2.5 md:gap-3 px-4 py-2.5 items-center text-xs cursor-pointer select-none">
                                
                                <!-- Coluna 1: Reordenação + Título + Botão Expandir Itens -->
                                <div class="md:col-span-5 flex items-center gap-2 min-w-0">
                                    <div class="inline-flex items-center rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-0.5 shrink-0" onclick="event.stopPropagation()">
                                        <button type="button" onclick="moveTaskOrder('${task.id}', -1)" class="w-4 h-4 rounded hover:bg-white dark:hover:bg-slate-700 text-slate-400 hover:text-indigo-500 flex items-center justify-center" title="Subir">
                                            <i class="fa-solid fa-chevron-up text-[8px]"></i>
                                        </button>
                                        <button type="button" onclick="moveTaskOrder('${task.id}', 1)" class="w-4 h-4 rounded hover:bg-white dark:hover:bg-slate-700 text-slate-400 hover:text-indigo-500 flex items-center justify-center" title="Descer">
                                            <i class="fa-solid fa-chevron-down text-[8px]"></i>
                                        </button>
                                    </div>

                                    <button type="button" onclick="event.stopPropagation(); toggleTaskCardCollapse('${task.id}')" class="flex items-center gap-2 min-w-0 flex-1 text-left group">
                                        <i class="fa-solid ${isCardExpanded ? 'fa-chevron-down text-indigo-500' : 'fa-chevron-right text-slate-400'} text-[10px] shrink-0 transition"></i>
                                        <span class="font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition ${task.status === 'done' ? 'line-through text-slate-400 dark:text-slate-500' : ''}" title="${escapeHtml(task.title)}">
                                            ${escapeHtml(task.title)}
                                        </span>
                                    </button>

                                    ${isHighlighted ? `
                                        <span class="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[9px] font-bold shrink-0">★</span>
                                    ` : ''}
                                </div>

                                <!-- Coluna 2: Responsável Principal -->
                                <div class="md:col-span-2 flex items-center gap-1.5 min-w-0" onclick="event.stopPropagation()">
                                    <i class="fa-solid fa-user-check text-indigo-500 text-[10px] shrink-0"></i>
                                    ${isCurrentUserAdmin ? `
                                        <select onchange="updateCardTaskAssignee('${task.id}', this.value)" class="w-full px-1.5 py-0.5 rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate cursor-pointer focus:outline-none focus:border-indigo-500">
                                            ${buildMemberSelectOptionsHTML(task.author || '', true, 'Sem resp.')}
                                        </select>
                                    ` : `
                                        <span class="truncate text-[11px] font-medium text-slate-600 dark:text-slate-300">${escapeHtml(task.author || 'Sem resp.')}</span>
                                    `}
                                </div>

                                <!-- Coluna 3: Criação, Vencimento & Prioridade -->
                                <div class="md:col-span-2 flex flex-col gap-0.5">
                                    <div class="flex items-center gap-1.5 flex-wrap">
                                        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${pri.badgeClass}">
                                            <i class="fa-solid ${pri.icon} text-[9px]"></i> ${pri.label}
                                        </span>
                                        <span class="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1" title="Data de Criação">
                                            <i class="fa-solid fa-calendar-plus text-indigo-500 text-[9px]"></i> Criada: ${formatCreatedAtDate(task.createdAt, true)}
                                        </span>
                                    </div>
                                    <span class="text-[11px] ${dueTextClass} flex items-center gap-1" title="Data de Vencimento">
                                        <i class="fa-regular fa-calendar text-[10px]"></i> Venc: ${formatDisplayDate(task.dueDate)}
                                    </span>
                                </div>

                                <!-- Coluna 4: Progresso Compacto de Subtarefas -->
                                <div class="md:col-span-1 flex items-center md:justify-center gap-1.5">
                                    ${subtasks.length > 0 ? `
                                        <button type="button" onclick="event.stopPropagation(); toggleTaskCardCollapse('${task.id}')" class="px-2 py-0.5 rounded-full text-[10px] font-bold border transition ${
                                            subDoneCount === subtasks.length
                                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                                : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20'
                                        }" title="Clique para mostrar/ocultar as ${subtasks.length} subtarefas">
                                            ${subDoneCount}/${subtasks.length}
                                        </button>
                                    ` : `<span class="text-[10px] text-slate-400">-</span>`}
                                </div>

                                <!-- Coluna 5: Seletor Rápido de Status + Editar/Excluir -->
                                <div class="md:col-span-2 flex items-center justify-end gap-1.5" onclick="event.stopPropagation()">
                                    <select onchange="updateTaskStatus('${task.id}', this.value)" ${allowStatus ? '' : 'disabled'} class="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer">
                                        <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>📋 A Fazer</option>
                                        <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>⏳ Em And.</option>
                                        <option value="done" ${task.status === 'done' ? 'selected' : ''}>✅ Concluído</option>
                                    </select>

                                    ${allowEdit ? `
                                        <button type="button" onclick="openTaskModal('${task.id}')" class="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-indigo-600 transition" title="Editar Tarefa">
                                            <i class="fa-solid fa-pen text-[11px]"></i>
                                        </button>
                                    ` : ''}
                                    ${allowDelete ? `
                                        <button type="button" onclick="deleteTask('${task.id}')" class="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 transition" title="Excluir Tarefa">
                                            <i class="fa-solid fa-trash text-[11px]"></i>
                                        </button>
                                    ` : ''}
                                </div>
                            </div>

                            <!-- Gaveta Simplificada de Subtarefas (Exibida apenas se clicar na linha da tarefa) -->
                            <div class="${isCardExpanded ? 'block' : 'hidden'} px-4 pb-3 pt-1 bg-slate-50/70 dark:bg-slate-900/40 border-t border-slate-100 dark:border-slate-800/80">
                                ${subtasks.length === 0 ? `
                                    <p class="text-[11px] text-slate-400 italic py-1">Nenhuma subtarefa cadastrada neste pedido.</p>
                                ` : `
                                    <div data-scroll-id="sublist_simple_${task.id}" onscroll="recordContainerScroll(this)" class="divide-y divide-slate-200/60 dark:divide-slate-800/70 max-h-60 overflow-y-auto pr-1">
                                        ${subtasks.map((sub, sIdx) => {
                                            const isAssignedToMe = doesAssigneeMatchUser(sub.assignee, currentAuthor, currentUserLogin);
                                            const canChangeThisSubAssignee = canReassignAnySubtask || isAssignedToMe || !sub.assignee;

                                            return `
                                                <div class="py-1.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 text-xs">
                                                    <div class="flex items-center gap-2 min-w-0 flex-1">
                                                        <input type="checkbox" ${sub.completed ? 'checked' : ''} ${allowSubtasks ? '' : 'disabled'} onchange="toggleSubtaskStatus('${task.id}', ${sIdx})" class="rounded text-indigo-600 w-3.5 h-3.5 cursor-pointer shrink-0">
                                                        <span class="truncate font-medium text-slate-700 dark:text-slate-200 ${sub.completed ? 'line-through opacity-55' : ''}" title="${escapeHtml(sub.text)}">${escapeHtml(sub.text)}</span>
                                                    </div>
                                                    <div class="flex items-center gap-1.5 shrink-0" onclick="event.stopPropagation()">
                                                        <div class="inline-flex items-center rounded bg-amber-500/10 border border-amber-500/25 px-1 py-0.5 gap-0.5" title="Horas da subtarefa">
                                                            <button type="button" onclick="adjustCardSubtaskHours('${task.id}', ${sIdx}, -0.5)" class="w-3.5 h-3.5 rounded hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-[10px]">-</button>
                                                            <input type="number" min="0.1" step="0.1" value="${Number(sub.hours || 2)}" onchange="updateCardSubtaskHours('${task.id}', ${sIdx}, this.value)" class="w-10 bg-transparent text-center font-mono font-bold text-[10px] text-amber-700 dark:text-amber-300 focus:outline-none">
                                                            <span class="text-[9px] font-bold text-amber-600 dark:text-amber-400">h</span>
                                                            <button type="button" onclick="adjustCardSubtaskHours('${task.id}', ${sIdx}, 0.5)" class="w-3.5 h-3.5 rounded hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-[10px]">+</button>
                                                        </div>
                                                        ${canChangeThisSubAssignee ? `
                                                            <select onchange="updateCardSubtaskAssignee('${task.id}', ${sIdx}, this.value)" class="w-36 px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-200 cursor-pointer">
                                                                ${buildMemberSelectOptionsHTML(sub.assignee || '', canReassignAnySubtask || isAssignedToMe, '👤 Atribuir...')}
                                                            </select>
                                                        ` : `
                                                            <span class="text-[11px] text-slate-500 px-1.5"><i class="fa-solid fa-lock text-[9px] mr-1"></i>${escapeHtml(sub.assignee)}</span>
                                                        `}
                                                    </div>
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                `}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}


// =========================================================================
// CONFIGURAÇÕES DE JORNADA DE TRABALHO, FERIADOS NACIONAIS/CUSTOMIZADOS,
// CLIQUE DIRETO COM CHECKBOX NO DIA E HORAS EXTRAS (SÁB, DOM E FERIADOS)
// =========================================================================
const WORK_SETTINGS_KEY = 'taskflow_pro_work_settings_v2';

// Feriados Nacionais Fixos Brasileiros (MM-DD)
const FIXED_BR_HOLIDAYS = {
    '01-01': 'Confraternização Universal',
    '04-21': 'Tiradentes',
    '05-01': 'Dia do Trabalhador',
    '09-07': 'Independência do Brasil',
    '10-12': 'Nossa Sra. Aparecida',
    '11-02': 'Finados',
    '11-15': 'Proclamação da República',
    '11-20': 'Dia da Consciência Negra',
    '12-25': 'Natal'
};

// Cálculo automático de Páscoa, Carnaval, Sexta-Feira Santa e Corpus Christi para qualquer ano
const _movableHolidayCache = {};
function getMovableHolidaysForYear(year) {
    if (_movableHolidayCache[year]) return _movableHolidayCache[year];
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    const easterMs = new Date(year, month - 1, day).setHours(0, 0, 0, 0);
    const DAY_MS = 86400000;

    const toDateKey = (ms) => {
        const dt = new Date(ms);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };

    const map = {};
    map[toDateKey(easterMs - 48 * DAY_MS)] = 'Segunda de Carnaval';
    map[toDateKey(easterMs - 47 * DAY_MS)] = 'Terça de Carnaval';
    map[toDateKey(easterMs - 2 * DAY_MS)]  = 'Sexta-feira Santa';
    map[toDateKey(easterMs + 60 * DAY_MS)] = 'Corpus Christi';

    _movableHolidayCache[year] = map;
    return map;
}

function getWorkSettings() {
    try {
        const raw = localStorage.getItem(WORK_SETTINGS_KEY) || localStorage.getItem('taskflow_pro_work_settings_v1');
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                workDays: parsed.workDays || { 1: true, 2: true, 3: true, 4: true, 5: true, 6: false, 0: false },
                weekendOvertime: Boolean(parsed.weekendOvertime),
                holidayOvertime: Boolean(parsed.holidayOvertime),
                dateOverrides: parsed.dateOverrides || {}, // { 'YYYY-MM-DD': 'work' | 'overtime' | 'off' }
                customHolidays: parsed.customHolidays || {} // { 'YYYY-MM-DD': 'Nome do Feriado' }
            };
        }
    } catch(e){}
    return {
        workDays: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: false, 0: false },
        weekendOvertime: false,
        holidayOvertime: false,
        dateOverrides: {},
        customHolidays: {}
    };
}

function saveWorkSettings(settings) {
    try {
        localStorage.setItem(WORK_SETTINGS_KEY, JSON.stringify(settings));
    } catch(e){}
}

function formatMsToDateIso(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getHolidayNameForDate(dateIsoStr, settings = null) {
    if (!dateIsoStr) return null;
    const st = settings || getWorkSettings();
    if (st.customHolidays && st.customHolidays[dateIsoStr]) {
        return st.customHolidays[dateIsoStr];
    }
    const parts = dateIsoStr.split('-');
    if (parts.length !== 3) return null;
    const year = parseInt(parts[0], 10);
    const mmdd = `${parts[1]}-${parts[2]}`;
    if (FIXED_BR_HOLIDAYS[mmdd]) return FIXED_BR_HOLIDAYS[mmdd];
    const mov = getMovableHolidaysForYear(year);
    return mov[dateIsoStr] || null;
}

/**
 * Avalia o status exato de um dia na Timeline:
 * - Por padrão: Seg a Sex = Trabalho (8h), Sáb/Dom e Feriados = Folga (a menos que marcados como Hora Extra).
 * - Se o usuário clicou no checkbox daquele dia específico na Timeline (dateOverrides[dateIso]), respeita a escolha!
 */
function evaluateTimelineDayStatus(dayMs, settings = null) {
    const st = settings || getWorkSettings();
    const d = new Date(dayMs);
    const dayOfWeek = d.getDay(); // 0 = Dom, 6 = Sáb
    const dateIso = formatMsToDateIso(dayMs);
    const holidayName = getHolidayNameForDate(dateIso, st);
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    const isHoliday = Boolean(holidayName);

    const override = st.dateOverrides ? st.dateOverrides[dateIso] : undefined;

    let isWorking = false;
    let isOvertime = false;

    if (override === 'overtime') {
        isWorking = true;
        isOvertime = true;
    } else if (override === 'work') {
        isWorking = true;
        isOvertime = isWeekend || isHoliday;
    } else if (override === 'off') {
        isWorking = false;
        isOvertime = false;
    } else {
        // Comportamento padrão: Feriados e Sáb/Dom são FOLGA, a menos que marcados como Hora Extra
        if (isHoliday) {
            if (st.holidayOvertime) {
                isWorking = true;
                isOvertime = true;
            } else {
                isWorking = false;
            }
        } else if (isWeekend) {
            if (st.workDays[dayOfWeek] || st.weekendOvertime) {
                isWorking = true;
                isOvertime = true;
            } else {
                isWorking = false;
            }
        } else {
            isWorking = Boolean(st.workDays[dayOfWeek]);
            isOvertime = false;
        }
    }

    let statusBadgeText = '8h Útil';
    if (!isWorking) {
        statusBadgeText = isHoliday ? 'Feriado (Folga)' : 'Folga';
    } else if (isOvertime) {
        statusBadgeText = isHoliday ? 'Feriado • H. Extra' : 'Hora Extra (8h)';
    }

    return {
        dateIso,
        dayOfWeek,
        isWeekend,
        isHoliday,
        holidayName,
        isWorking,
        isOvertime,
        isRestDay: !isWorking,
        statusBadgeText
    };
}

/**
 * Alterna o dia de trabalho clicando diretamente sobre o cabeçalho/checkbox daquele dia na Timeline:
 * - Se for Sábado, Domingo ou Feriado: marcar o checkbox ativa o dia como Hora Extra; desmarcar volta para Folga.
 * - Se for dia de semana comum: marcar ativa como Dia Útil (8h); desmarcar define como Folga/Recesso.
 */
function toggleTimelineDayWorkCheckbox(dateIsoStr) {
    const st = getWorkSettings();
    if (!st.dateOverrides) st.dateOverrides = {};

    const [y, m, d] = dateIsoStr.split('-').map(Number);
    const dayMs = new Date(y, m - 1, d).setHours(0, 0, 0, 0);
    const currentStatus = evaluateTimelineDayStatus(dayMs, st);
    const formattedDate = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;

    if (currentStatus.isWorking) {
        st.dateOverrides[dateIsoStr] = 'off';
        saveWorkSettings(st);
        showToast(`Dia ${formattedDate} definido como FOLGA no cronograma.`, 'info');
    } else {
        if (currentStatus.isWeekend || currentStatus.isHoliday) {
            st.dateOverrides[dateIsoStr] = 'overtime';
            saveWorkSettings(st);
            const reason = currentStatus.isHoliday ? `Feriado (${currentStatus.holidayName})` : 'Fim de Semana';
            showToast(`${formattedDate} (${reason}) ativado como HORA EXTRA (+8h)!`, 'success');
        } else {
            st.dateOverrides[dateIsoStr] = 'work';
            saveWorkSettings(st);
            showToast(`Dia ${formattedDate} ativado como Dia Útil de Trabalho (8h).`, 'success');
        }
    }
    renderAll();
}

function addCustomHolidayInModal() {
    const dateInp = document.getElementById('newHolidayDateInput');
    const nameInp = document.getElementById('newHolidayNameInput');
    const dateVal = (dateInp?.value || '').trim();
    const nameVal = (nameInp?.value || '').trim() || 'Feriado Municipal / Ponte';

    if (!dateVal) {
        showToast('Selecione a data do feriado.', 'error');
        return;
    }

    const st = getWorkSettings();
    if (!st.customHolidays) st.customHolidays = {};
    st.customHolidays[dateVal] = nameVal;
    // Garante que por padrão o novo feriado fique como folga até ser marcado como hora extra
    if (st.dateOverrides && st.dateOverrides[dateVal] === 'work') {
        delete st.dateOverrides[dateVal];
    }
    saveWorkSettings(st);
    openWorkSettingsModal();
    renderAll();
    showToast(`Feriado "${nameVal}" (${formatDisplayDate(dateVal)}) cadastrado como folga padrão!`, 'success');
}

function removeCustomHolidayInModal(dateIso) {
    const st = getWorkSettings();
    if (st.customHolidays && st.customHolidays[dateIso]) {
        delete st.customHolidays[dateIso];
        saveWorkSettings(st);
        openWorkSettingsModal();
        renderAll();
        showToast('Feriado personalizado removido.', 'info');
    }
}

function clearAllDateOverridesInModal() {
    const st = getWorkSettings();
    st.dateOverrides = {};
    saveWorkSettings(st);
    openWorkSettingsModal();
    renderAll();
    showToast('Exceções individuais de datas limpas (aplicando padrão semanal e feriados).', 'info');
}

function openWorkSettingsModal() {
    const st = getWorkSettings();
    const customEntries = Object.entries(st.customHolidays || {}).sort((a, b) => a[0].localeCompare(b[0]));
    const overridesCount = Object.keys(st.dateOverrides || {}).length;

    const modalHtml = `
        <div id="workSettingsModal" class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn overflow-y-auto">
            <div class="bg-white dark:bg-darkCard w-full max-w-lg rounded-2xl border border-slate-200 dark:border-darkBorder shadow-2xl overflow-hidden p-6 space-y-4 my-8">
                <div class="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700">
                    <h3 class="text-base font-bold flex items-center gap-2">
                        <i class="fa-solid fa-business-time text-indigo-500"></i> Configurar Jornada, Feriados & Horas Extras
                    </h3>
                    <button onclick="document.getElementById('workSettingsModal').remove()" class="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="space-y-3 text-xs max-h-[75vh] overflow-y-auto pr-1">
                    <div class="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 dark:text-indigo-300 leading-relaxed">
                        <i class="fa-solid fa-hand-pointer mr-1"></i><strong>Dica Rápida:</strong> Você também pode configurar os dias de trabalho clicando diretamente sobre o <strong>checkbox de cada dia no cabeçalho da Timeline</strong>! Sábados, domingos e feriados são considerados <strong>Folga</strong> por padrão, a menos que marcados como <strong>Hora Extra</strong>.
                    </div>

                    <div class="font-bold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                        Padrão Semanal da Equipe (8h/dia):
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <label class="flex items-center gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer">
                            <input type="checkbox" id="wDay_1" ${st.workDays[1] ? 'checked' : ''} class="rounded text-indigo-600 w-4 h-4">
                            <span class="font-bold">Segunda-feira</span>
                        </label>
                        <label class="flex items-center gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer">
                            <input type="checkbox" id="wDay_2" ${st.workDays[2] ? 'checked' : ''} class="rounded text-indigo-600 w-4 h-4">
                            <span class="font-bold">Terça-feira</span>
                        </label>
                        <label class="flex items-center gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer">
                            <input type="checkbox" id="wDay_3" ${st.workDays[3] ? 'checked' : ''} class="rounded text-indigo-600 w-4 h-4">
                            <span class="font-bold">Quarta-feira</span>
                        </label>
                        <label class="flex items-center gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer">
                            <input type="checkbox" id="wDay_4" ${st.workDays[4] ? 'checked' : ''} class="rounded text-indigo-600 w-4 h-4">
                            <span class="font-bold">Quinta-feira</span>
                        </label>
                        <label class="flex items-center gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer">
                            <input type="checkbox" id="wDay_5" ${st.workDays[5] ? 'checked' : ''} class="rounded text-indigo-600 w-4 h-4">
                            <span class="font-bold">Sexta-feira</span>
                        </label>
                        <label class="flex items-center gap-2 p-2 rounded-xl bg-amber-500/10 dark:bg-amber-950/20 border border-amber-500/30 cursor-pointer">
                            <input type="checkbox" id="wDay_6" ${st.workDays[6] ? 'checked' : ''} class="rounded text-amber-600 w-4 h-4">
                            <span class="font-bold text-amber-700 dark:text-amber-300">Sábado (Hora Extra)</span>
                        </label>
                        <label class="flex items-center gap-2 p-2 rounded-xl bg-rose-500/10 dark:bg-rose-950/20 border border-rose-500/30 cursor-pointer col-span-2">
                            <input type="checkbox" id="wDay_0" ${st.workDays[0] ? 'checked' : ''} class="rounded text-rose-600 w-4 h-4">
                            <span class="font-bold text-rose-700 dark:text-rose-300">Domingo (Folga Padrão / Marcar p/ Hora Extra)</span>
                        </label>
                    </div>

                    <div class="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                        <label class="flex items-center gap-2 cursor-pointer select-none">
                            <input type="checkbox" id="weekendOvertimeCheck" ${st.weekendOvertime ? 'checked' : ''} class="rounded text-amber-600 w-4 h-4">
                            <span class="font-semibold text-slate-700 dark:text-slate-200">Incluir todos os Sábados e Domingos como Hora Extra por padrão</span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer select-none">
                            <input type="checkbox" id="holidayOvertimeCheck" ${st.holidayOvertime ? 'checked' : ''} class="rounded text-amber-600 w-4 h-4">
                            <span class="font-semibold text-slate-700 dark:text-slate-200">Incluir Feriados Nacionais/Municipais como Hora Extra por padrão</span>
                        </label>
                    </div>

                    <!-- Gestão de Feriados Personalizados / Pontes -->
                    <div class="pt-3 border-t border-slate-200 dark:border-slate-700 space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="font-bold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400">
                                <i class="fa-solid fa-umbrella-beach text-rose-500 mr-1"></i>Feriados Nacionais (Automáticos) & Municipais
                            </span>
                        </div>
                        <p class="text-[11px] text-slate-400">
                            Feriados nacionais fixos e móveis (Carnaval, Sexta-feira Santa, Tiradentes, 1º de Maio, Corpus Christi, 7 de Setembro, 12/Out, Finados, 15/Nov, 20/Nov, Natal) já vêm configurados automaticamente como <strong>Folga</strong>. Adicione feriados locais abaixo se desejar:
                        </p>
                        <div class="flex flex-col sm:flex-row gap-2">
                            <input type="date" id="newHolidayDateInput" class="px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs">
                            <input type="text" id="newHolidayNameInput" placeholder="Nome do feriado ou ponte..." class="flex-1 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs">
                            <button type="button" onclick="addCustomHolidayInModal()" class="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shrink-0">
                                + Feriado
                            </button>
                        </div>
                        ${customEntries.length > 0 ? `
                            <div class="space-y-1 pt-1 max-h-28 overflow-y-auto">
                                ${customEntries.map(([dtIso, hName]) => `
                                    <div class="flex items-center justify-between px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[11px]">
                                        <span><strong>${formatDisplayDate(dtIso)}</strong> — ${escapeHtml(hName)}</span>
                                        <button type="button" onclick="removeCustomHolidayInModal('${dtIso}')" class="text-rose-500 hover:text-rose-700 font-bold px-1"><i class="fa-solid fa-trash-can"></i></button>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>

                    ${overridesCount > 0 ? `
                        <div class="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <span class="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                                <i class="fa-solid fa-calendar-check mr-1"></i>${overridesCount} data(s) com marcação individual na Timeline
                            </span>
                            <button type="button" onclick="clearAllDateOverridesInModal()" class="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-rose-500/15 text-slate-600 dark:text-slate-300 hover:text-rose-500 text-[11px] font-semibold transition">
                                Restaurar Padrão nas Datas
                            </button>
                        </div>
                    ` : ''}
                </div>

                <div class="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <button onclick="document.getElementById('workSettingsModal').remove()" class="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold">Cancelar</button>
                    <button onclick="saveWorkSettingsFromModal()" class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md">Salvar Jornada</button>
                </div>
            </div>
        </div>
    `;
    const existing = document.getElementById('workSettingsModal');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function saveWorkSettingsFromModal() {
    const prev = getWorkSettings();
    const workDays = {
        1: Boolean(document.getElementById('wDay_1')?.checked),
        2: Boolean(document.getElementById('wDay_2')?.checked),
        3: Boolean(document.getElementById('wDay_3')?.checked),
        4: Boolean(document.getElementById('wDay_4')?.checked),
        5: Boolean(document.getElementById('wDay_5')?.checked),
        6: Boolean(document.getElementById('wDay_6')?.checked),
        0: Boolean(document.getElementById('wDay_0')?.checked)
    };
    const weekendOvertime = Boolean(document.getElementById('weekendOvertimeCheck')?.checked);
    const holidayOvertime = Boolean(document.getElementById('holidayOvertimeCheck')?.checked);
    saveWorkSettings({
        workDays,
        weekendOvertime,
        holidayOvertime,
        dateOverrides: prev.dateOverrides || {},
        customHolidays: prev.customHolidays || {}
    });
    document.getElementById('workSettingsModal')?.remove();
    showToast('Configurações de jornada, feriados e horas extras salvas!', 'success');
    renderAll();
}

// =========================================================================
// MOTOR DE GESTÃO DE HORAS (8H DIÁRIAS), DIAS ÚTEIS E GANTT / TIMELINE
// =========================================================================
const DAILY_WORK_HOURS = 8;

async function updateCardSubtaskHours(taskId, subIdx, newHoursVal) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.subtasks || !task.subtasks[subIdx]) return;
    ensureSubtaskStructure(task.subtasks);

    const h = Math.max(0.1, Math.round((parseFloat(newHoursVal) || 0.5) * 10) / 10);
    task.subtasks[subIdx].hours = h;
    task.updatedAt = Date.now();
    saveLocalCacheOnly();
    renderAll();
    await upsertTaskToCloud(task);
}

async function adjustCardSubtaskHours(taskId, subIdx, delta) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.subtasks || !task.subtasks[subIdx]) return;
    ensureSubtaskStructure(task.subtasks);

    const cur = Number(task.subtasks[subIdx].hours) || 2;
    task.subtasks[subIdx].hours = Math.max(0.1, Math.round((cur + delta) * 10) / 10);
    task.updatedAt = Date.now();
    saveLocalCacheOnly();
    renderAll();
    await upsertTaskToCloud(task);
}

async function adjustStandaloneTaskHours(taskId, delta, directValue = null) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const cur = Number(task.estimatedHours) || 8;
    const nextVal = directValue !== null ? parseFloat(directValue) : (cur + delta);
    task.estimatedHours = Math.max(0.1, Math.round((nextVal || 8) * 10) / 10);
    task.updatedAt = Date.now();
    saveLocalCacheOnly();
    renderAll();
    await upsertTaskToCloud(task);
}

async function distributeCardSubtaskHours(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !Array.isArray(task.subtasks) || task.subtasks.length === 0) return;
    ensureSubtaskStructure(task.subtasks);

    // Filtra apenas as subtarefas PENDENTES — nunca altera as horas das subtarefas já concluídas!
    const pendingSubs = task.subtasks.filter(s => !s.completed);
    const completedSubs = task.subtasks.filter(s => Boolean(s.completed));
    if (pendingSubs.length === 0) {
        showToast('Todas as subtarefas desta tarefa já foram concluídas! Nenhuma hora foi alterada.', 'info');
        return;
    }

    const completedHoursSum = completedSubs.reduce((acc, s) => acc + (Number(s.hours) || 2), 0);

    const st = getWorkSettings();
    const DAY_MS = 86400000;
    const startMs = task.createdAt ? new Date(task.createdAt).setHours(0,0,0,0) : new Date().setHours(0,0,0,0);
    let endMs = startMs + DAY_MS;
    if (task.dueDate) {
        const [y, m, d] = task.dueDate.split('-');
        endMs = new Date(y, m - 1, d).setHours(0,0,0,0);
    }

    let workingDaysCount = 0;
    let cursorMs = startMs;
    const maxLoopMs = Math.max(startMs, endMs);
    while (cursorMs <= maxLoopMs) {
        const dayEval = evaluateTimelineDayStatus(cursorMs, st);
        if (dayEval.isWorking) workingDaysCount++;
        cursorMs += DAY_MS;
    }
    workingDaysCount = Math.max(1, workingDaysCount);

    const totalHours = workingDaysCount * DAILY_WORK_HOURS;
    const remainingHoursForPending = Math.max(pendingSubs.length * 0.1, totalHours - completedHoursSum);
    const suggestedPerSub = Math.max(0.1, Math.round((remainingHoursForPending / pendingSubs.length) * 10) / 10);

    const suggestedMacro = task.macroTotalHours
        ? Math.max(0.1, Number(task.macroTotalHours) - completedHoursSum)
        : remainingHoursForPending;

    openSubtaskHoursDistributionModal({
        title: `Tempo Macro & Subtarefas — ${task.title}`,
        subtasksCount: pendingSubs.length,
        completedCount: completedSubs.length,
        completedHoursSum,
        suggestedHours: suggestedPerSub,
        suggestedMacroHours: suggestedMacro,
        diffDays: workingDaysCount,
        totalAvailableHours: totalHours,
        initialMode: 'macro',
        onConfirm: async (chosenHours, chosenMacroTotal) => {
            task.subtasks.forEach(s => {
                if (!s.completed) {
                    s.hours = chosenHours;
                }
            });
            task.macroTotalHours = Math.round(((chosenMacroTotal || (chosenHours * pendingSubs.length)) + completedHoursSum) * 10) / 10;
            task.estimatedHours = task.macroTotalHours;
            task.updatedAt = Date.now();
            saveLocalCacheOnly();
            renderAll();
            await upsertTaskToCloud(task);
            showToast(
                completedSubs.length > 0
                    ? `Tempo Macro distribuído nas ${pendingSubs.length} pendente(s) (${chosenHours}h cada). As ${completedSubs.length} concluída(s) (${completedHoursSum}h) foram preservadas!`
                    : `Tempo Macro (${task.macroTotalHours}h) distribuído em "${task.title}": ${chosenHours}h por subtarefa!`,
                'success'
            );
        }
    });
}

async function autoBalanceTeamSubtasksAndHours() {
    if (!hasUserPermission('canEdit') && !isCurrentUserAdmin) {
        showToast('Sem permissão para redistribuir tarefas da equipe.', 'error');
        return;
    }
    const members = getAllTeamMembersList().map(m => m.name).filter(Boolean);
    if (members.length === 0) {
        showToast('Cadastre membros na equipe primeiro para distribuir a carga.', 'info');
        return;
    }

    const visibleTasks = getFilteredTasks();
    if (visibleTasks.length === 0) return;

    const memberLoadMap = new Map();
    members.forEach(m => memberLoadMap.set(m, 0));

    visibleTasks.forEach(task => {
        ensureSubtaskStructure(task.subtasks);
        if (task.subtasks && task.subtasks.length > 0) {
            task.subtasks.forEach(sub => {
                const h = Number(sub.hours) || 2;
                if (!sub.assignee || !memberLoadMap.has(sub.assignee)) {
                    let lightestMember = members[0];
                    let minLoad = Infinity;
                    memberLoadMap.forEach((load, mName) => {
                        if (load < minLoad) {
                            minLoad = load;
                            lightestMember = mName;
                        }
                    });
                    sub.assignee = lightestMember;
                }
                memberLoadMap.set(sub.assignee, (memberLoadMap.get(sub.assignee) || 0) + h);
            });
        } else {
            const h = Number(task.estimatedHours) || 8;
            if (!task.author || !memberLoadMap.has(task.author)) {
                let lightestMember = members[0];
                let minLoad = Infinity;
                memberLoadMap.forEach((load, mName) => {
                    if (load < minLoad) {
                        minLoad = load;
                        lightestMember = mName;
                    }
                });
                task.author = lightestMember;
            }
            memberLoadMap.set(task.author, (memberLoadMap.get(task.author) || 0) + h);
        }
        task.updatedAt = Date.now();
    });

    saveLocalCacheOnly();
    renderAll();
    showToast(`Carga distribuída e balanceada entre ${members.length} membro(s) considerando 8h/dia!`, 'success');
}

// =========================================================================
// CONTROLES DE NAVEGAÇÃO TEMPORAL DA TIMELINE (PASSADO / HOJE / FUTURO),
// ESCALA AUTOMÁTICA POR DIAS OU SEMANAS DO MÊS E AJUSTE TOTAL NA TELA
// =========================================================================
let ganttDayOffset = 0;       // Deslocamento em dias corridos (negativo = passado, 0 = hoje, positivo = futuro)
let ganttWindowDays = 15;     // Janela visível padrão de dias na Timeline (7, 10, 14, 15, 21, 30, 60 e 90 dias)
let ganttScaleMode = 'auto';  // 'auto' (<=15d = diário, >=21d = semanas do mês) | 'days' | 'weeks'
let ganttFitToScreen = true;  // Ajusta automaticamente para caber 100% na largura da tela sem rolagem horizontal
let ganttNowTimer = null;

function shiftGanttTimelineDays(deltaDays) {
    ganttDayOffset += Number(deltaDays) || 0;
    renderAll();
}

function resetGanttTimelineToToday() {
    ganttDayOffset = 0;
    renderAll();
}

function setGanttTimelineOffsetSlider(val) {
    ganttDayOffset = parseInt(val, 10) || 0;
    renderAll();
}

function setGanttTimelineWindowDays(daysVal) {
    ganttWindowDays = Math.max(7, Math.min(90, parseInt(daysVal, 10) || 15));
    renderAll();
}

function setGanttScaleMode(modeVal) {
    if (['auto', 'days', 'weeks'].includes(modeVal)) {
        ganttScaleMode = modeVal;
        renderAll();
    }
}

function toggleGanttFitToScreen() {
    ganttFitToScreen = !ganttFitToScreen;
    renderAll();
}

/**
 * Alterna trabalho/folga/hora extra para todos os dias de uma Semana do Mês de uma só vez
 */
function toggleTimelineWeekWorkCheckbox(datesCsv) {
    if (!datesCsv) return;
    const isoList = String(datesCsv).split(',').map(s => s.trim()).filter(Boolean);
    if (isoList.length === 0) return;

    const st = getWorkSettings();
    if (!st.dateOverrides) st.dateOverrides = {};

    // Verifica quantos dias dessa semana estão ativos atualmente
    const evals = isoList.map(iso => {
        const [y, m, d] = iso.split('-').map(Number);
        const dayMs = new Date(y, m - 1, d).setHours(0, 0, 0, 0);
        return { iso, status: evaluateTimelineDayStatus(dayMs, st) };
    });

    const allWorking = evals.every(e => e.status.isWorking);
    const anyWeekdayWorking = evals.some(e => !e.status.isWeekend && !e.status.isHoliday && e.status.isWorking);

    if (!anyWeekdayWorking) {
        // Nenhum dia útil ativo -> Ativa os dias úteis (Seg-Sex) dessa semana
        evals.forEach(e => {
            if (!e.status.isWeekend && !e.status.isHoliday) {
                st.dateOverrides[e.iso] = 'work';
            }
        });
        saveWorkSettings(st);
        showToast('Dias úteis da semana ativados (8h/dia)!', 'success');
    } else if (!allWorking) {
        // Dias úteis já estão ativos -> Ativa também Sáb/Dom/Feriados da semana como Hora Extra!
        evals.forEach(e => {
            if (e.status.isWeekend || e.status.isHoliday) {
                st.dateOverrides[e.iso] = 'overtime';
            } else {
                st.dateOverrides[e.iso] = 'work';
            }
        });
        saveWorkSettings(st);
        showToast('Semana inteira ativada (incluindo Sáb/Dom/Feriados como Hora Extra)!', 'success');
    } else {
        // Todos já estavam ativos -> Restaura padrão semanal daquela semana (folga no fim de semana/feriado)
        evals.forEach(e => {
            delete st.dateOverrides[e.iso];
        });
        saveWorkSettings(st);
        showToast('Semana restaurada para a jornada padrão (Fins de semana e feriados como Folga).', 'info');
    }
    renderAll();
}

function jumpGanttTimelineToDate(dateStr) {
    if (!dateStr) return;
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return;
    const targetMs = new Date(y, m - 1, d).setHours(0, 0, 0, 0);
    const todayMs = new Date().setHours(0, 0, 0, 0);
    const diffDays = Math.round((targetMs - todayMs) / (1000 * 60 * 60 * 24));
    ganttDayOffset = diffDays;
    renderAll();
}

function getNowTimelineMetrics(viewStartMs, totalTimelineDays) {
    const DAY_MS = 1000 * 60 * 60 * 24;
    const now = new Date();
    const todayZeroMs = new Date(now).setHours(0, 0, 0, 0);

    const secondsInDay = (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds();
    const dayFraction = secondsInDay / 86400;

    const exactNowMs = todayZeroMs + (dayFraction * DAY_MS);
    const totalSpanMs = totalTimelineDays * DAY_MS;
    const percentLeft = ((exactNowMs - viewStartMs) / totalSpanMs) * 100;

    const dateTimeLabel = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
        ' • ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    return {
        isVisible: percentLeft >= 0 && percentLeft <= 100,
        percentLeft: Math.max(0, Math.min(100, percentLeft)),
        dateTimeLabel,
        todayZeroMs
    };
}

if (!ganttNowTimer) {
    ganttNowTimer = setInterval(() => {
        if (typeof currentView !== 'undefined' && currentView === 'gantt') {
            renderAll();
        }
    }, 60000);
}

/**
 * Avança um cursor de tempo (em ms) para o próximo instante em que o dia seja de trabalho
 * (pula automaticamente sábados, domingos e feriados que estejam como folga).
 */
function snapToWorkingDayMs(cursorMs, settings) {
    const DAY_MS = 86400000;
    let dayStartMs = new Date(cursorMs).setHours(0, 0, 0, 0);
    let offsetInDayMs = Math.max(0, cursorMs - dayStartMs);
    let guard = 0;
    while (guard < 366) {
        const status = evaluateTimelineDayStatus(dayStartMs, settings);
        if (status.isWorking) {
            return dayStartMs + offsetInDayMs;
        }
        dayStartMs += DAY_MS;
        offsetInDayMs = 0; // Ao pular um dia de folga, começa no início (00:00) do próximo dia útil
        guard++;
    }
    return cursorMs;
}

/**
 * Calcula startMs e endMs reais alocando `hoursToSchedule` horas (base 8h/dia)
 * pulando todos os dias de folga (Sáb, Dom e Feriados não marcados como Hora Extra).
 */
function allocateWorkingHoursOnTimeline(initialCursorMs, hoursToSchedule, settings) {
    const DAY_MS = 86400000;
    let startMs = snapToWorkingDayMs(initialCursorMs, settings);
    let cursorMs = startMs;
    let remainingHours = Math.max(0.1, Number(hoursToSchedule) || 2);
    let guard = 0;

    while (remainingHours > 0.0001 && guard < 730) {
        guard++;
        const dayStartMs = new Date(cursorMs).setHours(0, 0, 0, 0);
        const dayStatus = evaluateTimelineDayStatus(dayStartMs, settings);

        if (!dayStatus.isWorking) {
            // Dia de folga (Sábado, Domingo ou Feriado sem hora extra): avança para o dia seguinte
            cursorMs = dayStartMs + DAY_MS;
            continue;
        }

        const usedFractionToday = Math.max(0, Math.min(1, (cursorMs - dayStartMs) / DAY_MS));
        const availableHoursToday = Math.max(0, (1 - usedFractionToday) * DAILY_WORK_HOURS);

        if (availableHoursToday <= 0.0001) {
            cursorMs = dayStartMs + DAY_MS;
            continue;
        }

        const consumeHours = Math.min(remainingHours, availableHoursToday);
        remainingHours -= consumeHours;
        cursorMs += (consumeHours / DAILY_WORK_HOURS) * DAY_MS;

        if (remainingHours > 0.0001) {
            cursorMs = dayStartMs + DAY_MS;
        }
    }

    return {
        startMs,
        endMs: cursorMs,
        nextCursorMs: cursorMs
    };
}

/**
 * Agrupa os dias da janela da Timeline em Semanas do Mês (Sem. 1, Sem. 2, Sem. 3, Sem. 4, Sem. 5 de cada mês)
 * para exibição limpa e sem esmagamento quando a escala de dias é grande (21, 30, 60 ou 90 dias).
 */
function buildMonthWeekBuckets(dayColumns) {
    const buckets = [];
    const monthNamesShort = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    dayColumns.forEach(col => {
        const d = new Date(col.colMs);
        const year = d.getFullYear();
        const month = d.getMonth();
        const dayOfMonth = d.getDate();
        // Calcula a Semana do Mês (1ª a 5ª semana do mês)
        const weekOfMonth = Math.min(5, Math.ceil(dayOfMonth / 7));
        const bucketKey = `${year}-${month}-W${weekOfMonth}`;

        let currentBucket = buckets.length > 0 ? buckets[buckets.length - 1] : null;
        if (!currentBucket || currentBucket.key !== bucketKey) {
            currentBucket = {
                key: bucketKey,
                year,
                month,
                monthLabel: monthNamesShort[month],
                weekOfMonth,
                titleLabel: `${weekOfMonth}ª Sem • ${monthNamesShort[month]}`,
                shortLabel: `S${weekOfMonth}/${monthNamesShort[month]}`,
                days: [],
                daysCount: 0,
                workingDaysCount: 0,
                overtimeDaysCount: 0,
                restDaysCount: 0,
                hasToday: false
            };
            buckets.push(currentBucket);
        }

        currentBucket.days.push(col);
        currentBucket.daysCount++;
        if (col.isWorking) currentBucket.workingDaysCount++;
        if (col.isOvertime) currentBucket.overtimeDaysCount++;
        if (col.isRestDay) currentBucket.restDaysCount++;
        if (col.isTodayCol) currentBucket.hasToday = true;
    });

    buckets.forEach(b => {
        const firstDay = b.days[0];
        const lastDay = b.days[b.days.length - 1];
        b.rangeLabel = firstDay.label === lastDay.label
            ? firstDay.label
            : `${firstDay.label.slice(0, 2)} a ${lastDay.label}`;
        b.datesCsv = b.days.map(x => x.dateIso).join(',');
    });

    return buckets;
}

function renderGanttView(filteredTasks, containerEl) {
    const DAY_MS = 1000 * 60 * 60 * 24;
    const settings = getWorkSettings();

    const workItemsByUser = {};

    // Verifica se estamos em uma sala individual de membro ou se há filtro de membro ativo
    const roomOwner = getRoomOwnerDescriptor(currentWorkspace);
    const activeMemberFilterVal = (document.getElementById('memberFilter')?.value || 'all').toLowerCase().trim();

    const shouldShowAssigneeInCurrentDiagram = (assigneeName) => {
        if (roomOwner) {
            if (!doesAssigneeMatchUser(assigneeName, roomOwner)) return false;
        }
        if (activeMemberFilterVal !== 'all') {
            if (normalizeIdentityStr(assigneeName) !== activeMemberFilterVal) return false;
        }
        return true;
    };

    filteredTasks.forEach(task => {
        if (Array.isArray(task.subtasks) && task.subtasks.length > 1) {
            groupCompletedSubtasksAtTop(task);
        }
        const subs = ensureSubtaskStructure(task.subtasks || []);
        const taskStartDayMs = task.createdAt
            ? new Date(task.createdAt).setHours(0, 0, 0, 0)
            : new Date().setHours(0, 0, 0, 0);

        if (subs.length > 0) {
            subs.forEach((sub, sIdx) => {
                const assignee = (sub.assignee || task.author || 'Sem responsável').trim() || 'Sem responsável';
                if (!shouldShowAssigneeInCurrentDiagram(assignee)) return;
                if (!workItemsByUser[assignee]) workItemsByUser[assignee] = [];
                workItemsByUser[assignee].push({
                    type: 'subtask',
                    taskId: task.id,
                    subIdx: sIdx,
                    taskTitle: task.title,
                    itemTitle: sub.text,
                    hours: Math.max(0.1, Number(sub.hours) || 2),
                    completed: Boolean(sub.completed || task.status === 'done'),
                    priority: task.priority || 'media',
                    dueDate: task.dueDate,
                    baseStartMs: taskStartDayMs
                });
            });
        } else {
            const assignee = (task.author || 'Sem responsável').trim() || 'Sem responsável';
            if (!shouldShowAssigneeInCurrentDiagram(assignee)) return;
            if (!workItemsByUser[assignee]) workItemsByUser[assignee] = [];
            workItemsByUser[assignee].push({
                type: 'task',
                taskId: task.id,
                subIdx: -1,
                taskTitle: task.title,
                itemTitle: task.title,
                hours: Math.max(0.1, Number(task.estimatedHours) || 8),
                completed: task.status === 'done',
                priority: task.priority || 'media',
                dueDate: task.dueDate,
                baseStartMs: taskStartDayMs
            });
        }
    });

    const userNames = Object.keys(workItemsByUser).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (userNames.length === 0) {
        containerEl.innerHTML = `<div class="bg-white dark:bg-darkCard rounded-2xl border border-slate-200 dark:border-darkBorder p-10 text-center text-slate-500">Nenhuma tarefa ou subtarefa disponível para o Gráfico de Gantt.</div>`;
        return;
    }

    let globalMinDayMs = Infinity;
    let globalMaxDayMs = -Infinity;
    const scheduledByUser = {};
    let totalSystemHours = 0;

    userNames.forEach(user => {
        const rawItems = workItemsByUser[user];
        const macroGroupsMap = new Map();
        rawItems.forEach(item => {
            const parentTaskObj = tasks.find(t => t.id === item.taskId);
            if (!macroGroupsMap.has(item.taskId)) {
                macroGroupsMap.set(item.taskId, {
                    taskId: item.taskId,
                    taskTitle: item.taskTitle,
                    priority: item.priority,
                    dueDate: item.dueDate,
                    dueEndMs: getTaskDueDateEndMs(item.dueDate),
                    createdAtMs: parentTaskObj?.createdAt || item.baseStartMs,
                    simultaneous: Boolean(parentTaskObj?.simultaneous),
                    baseStartMs: item.baseStartMs,
                    subItems: [],
                    scheduledSubs: []
                });
            }
            macroGroupsMap.get(item.taskId).subItems.push(item);
        });

        macroGroupsMap.forEach(macro => {
            macro.orderedQueue = [
                ...macro.subItems.filter(it => it.completed),
                ...macro.subItems.filter(it => !it.completed)
            ];
            macro.queuePtr = 0;
        });

        let currentEpochMs = null;
        let userTotalHours = 0;
        let userDoneHours = 0;

        const allMacros = Array.from(macroGroupsMap.values());
        let idxM = 0;

        while (idxM < allMacros.length) {
            const currentMacro = allMacros[idxM];

            // Se a tarefa está marcada como Simultânea, intercala as subtarefas entre as tarefas simultâneas
            if (currentMacro.simultaneous) {
                const simGroup = allMacros.filter((m, k) => k >= idxM && m.simultaneous && !m._scheduledDone);
                if (simGroup.length >= 2) {
                    let hasRemaining = true;
                    while (hasRemaining) {
                        hasRemaining = false;
                        for (const m of simGroup) {
                            if (m.queuePtr < m.orderedQueue.length) {
                                hasRemaining = true;
                                const item = m.orderedQueue[m.queuePtr++];
                                if (currentEpochMs === null || item.baseStartMs > currentEpochMs) {
                                    currentEpochMs = item.baseStartMs;
                                }
                                const alloc = allocateWorkingHoursOnTimeline(currentEpochMs, item.hours, settings);
                                currentEpochMs = alloc.nextCursorMs;

                                const exceedsDeadline = Boolean(m.dueEndMs && alloc.endMs > m.dueEndMs && !item.completed);
                                m.scheduledSubs.push({
                                    ...item,
                                    startMs: alloc.startMs,
                                    endMs: alloc.endMs,
                                    exceedsDeadline,
                                    endFormatted: new Date(alloc.endMs - 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
                                    durationDays: (item.hours / DAILY_WORK_HOURS).toFixed(2)
                                });
                            }
                        }
                    }
                    simGroup.forEach(m => { m._scheduledDone = true; });
                    idxM++;
                    continue;
                }
            }

            if (!currentMacro._scheduledDone) {
                currentMacro.orderedQueue.forEach(item => {
                    if (currentEpochMs === null || item.baseStartMs > currentEpochMs) {
                        currentEpochMs = item.baseStartMs;
                    }
                    const alloc = allocateWorkingHoursOnTimeline(currentEpochMs, item.hours, settings);
                    currentEpochMs = alloc.nextCursorMs;

                    const exceedsDeadline = Boolean(currentMacro.dueEndMs && alloc.endMs > currentMacro.dueEndMs && !item.completed);
                    currentMacro.scheduledSubs.push({
                        ...item,
                        startMs: alloc.startMs,
                        endMs: alloc.endMs,
                        exceedsDeadline,
                        endFormatted: new Date(alloc.endMs - 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
                        durationDays: (item.hours / DAILY_WORK_HOURS).toFixed(2)
                    });
                });
                currentMacro._scheduledDone = true;
            }
            idxM++;
        }

        const macroList = allMacros.map(macro => {
            let subMinStartMs = Infinity;
            let subMaxEndMs = -Infinity;
            let macroHours = 0;
            let macroDoneHours = 0;
            let completedCount = 0;
            let exceedingSubCount = 0;

            macro.scheduledSubs.forEach(sub => {
                if (sub.startMs < subMinStartMs) subMinStartMs = sub.startMs;
                if (sub.endMs > subMaxEndMs) subMaxEndMs = sub.endMs;

                macroHours += sub.hours;
                userTotalHours += sub.hours;
                totalSystemHours += sub.hours;

                if (sub.completed) {
                    macroDoneHours += sub.hours;
                    userDoneHours += sub.hours;
                    completedCount++;
                }
                if (sub.exceedsDeadline) {
                    exceedingSubCount++;
                }
            });

            // A Barra da Tarefa Principal inicia exatamente na Data de Criação (00:00) e termina exatamente no fim da Data de Vencimento (23:59:59)!
            const creationDayStartMs = macro.baseStartMs;
            const macroBarStartMs = creationDayStartMs;
            const macroBarEndMs = macro.dueEndMs
                ? Math.max(macroBarStartMs + DAY_MS, macro.dueEndMs + 1)
                : (subMaxEndMs !== -Infinity ? subMaxEndMs : (macroBarStartMs + DAY_MS));

            if (macroBarStartMs < globalMinDayMs) globalMinDayMs = macroBarStartMs;
            if (macroBarEndMs > globalMaxDayMs) globalMaxDayMs = macroBarEndMs;

            return {
                ...macro,
                macroKey: `${user}::${macro.taskId}`,
                startMs: macroBarStartMs,
                endMs: macroBarEndMs,
                subMaxEndMs,
                createdShortLabel: formatCreatedAtDate(macro.createdAtMs, true),
                createdFullLabel: formatCreatedAtDate(macro.createdAtMs, false),
                dueShortLabel: macro.dueDate ? formatDisplayDate(macro.dueDate).slice(0, 5) : 'S/ prazo',
                dueFullLabel: formatDisplayDate(macro.dueDate),
                totalHours: formatTotalHours1Dec(macroHours),
                doneHours: formatTotalHours1Dec(macroDoneHours),
                durationDays: (macroHours / DAILY_WORK_HOURS).toFixed(1),
                completedCount,
                totalCount: macro.scheduledSubs.length,
                exceedingSubCount,
                allCompleted: completedCount === macro.scheduledSubs.length && macro.scheduledSubs.length > 0,
                hasSubtasks: macro.scheduledSubs.length > 1 || (macro.scheduledSubs.length === 1 && macro.scheduledSubs[0].type === 'subtask'),
                scheduledSubs: macro.scheduledSubs
            };
        });

        scheduledByUser[user] = {
            macros: macroList,
            rawTotalHours: userTotalHours,
            rawDoneHours: userDoneHours,
            totalHours: formatTotalHours1Dec(userTotalHours),
            doneHours: formatTotalHours1Dec(userDoneHours),
            totalDays: (userTotalHours / DAILY_WORK_HOURS).toFixed(1)
        };
    });

    // Janela de visualização controlada pela barra de movimentação (Passado <-> Hoje <-> Futuro)
    const todayZeroMs = new Date().setHours(0, 0, 0, 0);
    const viewStartMs = todayZeroMs + (ganttDayOffset * DAY_MS);
    const totalTimelineDays = Math.max(7, ganttWindowDays);
    const viewEndMs = viewStartMs + (totalTimelineDays * DAY_MS);

    // Decide automaticamente se agrupa o cabeçalho por Semanas do Mês quando necessário (>= 21 dias) ou se o usuário escolheu manualmente
    const useMonthWeeksHeader = ganttScaleMode === 'weeks' || (ganttScaleMode === 'auto' && totalTimelineDays >= 21);

    const viewStartDateInputVal = getLocalDateStr(ganttDayOffset);
    const rangeStartLabel = new Date(viewStartMs).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const rangeEndLabel = new Date(viewEndMs - DAY_MS).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // Cálculo da posição exata da linha vermelha vertical (Data e Horário Atual)
    const nowMetrics = getNowTimelineMetrics(viewStartMs, totalTimelineDays);

    const dayColumns = Array.from({ length: totalTimelineDays }, (_, i) => {
        const colMs = viewStartMs + (i * DAY_MS);
        const d = new Date(colMs);
        const evalDay = evaluateTimelineDayStatus(colMs, settings);
        const isTodayCol = colMs === todayZeroMs;
        const dayStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const weekDay = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
        return {
            index: i + 1,
            colMs,
            dayNum: d.getDate(),
            label: dayStr,
            weekDay,
            isTodayCol,
            ...evalDay
        };
    });

    const weekBuckets = buildMonthWeekBuckets(dayColumns);

    const visibleOvertimeDaysCount = dayColumns.filter(c => c.isOvertime).length;
    const visibleRestDaysCount = dayColumns.filter(c => c.isRestDay).length;

    // Quando "Ajustar à Tela" (ganttFitToScreen) está ativo, a largura usa 100% do espaço disponível na tela sem precisar rolar na horizontal!
    const dayColMinPx = ganttFitToScreen ? 0 : (useMonthWeeksHeader ? 24 : 58);
    const timelineTrackStyle = ganttFitToScreen
        ? `flex: 1 1 0%; min-width: 0; width: 100%;`
        : `width: ${totalTimelineDays * dayColMinPx}px; flex-shrink: 0;`;

    let html = `
        <div class="bg-white dark:bg-darkCard rounded-2xl border border-slate-200 dark:border-darkBorder shadow-sm p-3 sm:p-4 space-y-2.5 w-full overflow-hidden">
            <!-- Barra Superior: Resumo de Capacidade (8h Diárias), Configurar Jornada e Ações -->
            <div class="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-slate-800">
                <div class="flex flex-wrap items-center gap-1.5">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 text-xs font-bold">
                        <i class="fa-solid fa-chart-gantt"></i> Timeline (8h/dia)
                    </span>
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-xs font-bold">
                        <i class="fa-regular fa-clock"></i> Carga: ${formatTotalHours1Dec(totalSystemHours)}h (${(totalSystemHours / DAILY_WORK_HOURS).toFixed(1)}d úteis)
                    </span>
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/25 text-xs font-bold" title="Horário atual representado pela linha vermelha vertical na Timeline">
                        <span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                        <span>Agora: ${nowMetrics.dateTimeLabel}</span>
                    </span>
                    <span class="text-[11px] text-slate-500 dark:text-slate-400 hidden 2xl:inline">
                        <i class="fa-regular fa-square-check text-indigo-500 mr-1"></i>Clique no <strong>checkbox do dia ou da semana</strong> abaixo para ativar/desativar trabalho ou <strong>Hora Extra</strong>.
                    </span>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                    <!-- Botão Ajustar para Caber na Tela -->
                    <button type="button" onclick="toggleGanttFitToScreen()" class="px-2.5 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 ${
                        ganttFitToScreen
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                    }" title="Ajustar automaticamente a largura das colunas para que todo o período caiba na tela sem rolagem horizontal">
                        <i class="fa-solid ${ganttFitToScreen ? 'fa-compress' : 'fa-expand'} text-[10px]"></i>
                        <span>${ganttFitToScreen ? 'Cabendo na Tela' : 'Largura Expandida'}</span>
                    </button>

                    <!-- Seletor de Agrupamento de Datas (Automático / Dias / Semanas do Mês) -->
                    <div class="inline-flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold">
                        <button type="button" onclick="setGanttScaleMode('auto')" class="px-2 py-1 rounded-lg transition ${ganttScaleMode === 'auto' ? 'bg-white dark:bg-darkCard text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}" title="Modo Automático: exibe Dias até 15d e agrupa em Semanas do Mês para 21d, 30d, 60d e 90d">
                            Auto
                        </button>
                        <button type="button" onclick="setGanttScaleMode('days')" class="px-2 py-1 rounded-lg transition ${ganttScaleMode === 'days' ? 'bg-white dark:bg-darkCard text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}" title="Exibir todas as datas individualmente dia a dia">
                            Dias
                        </button>
                        <button type="button" onclick="setGanttScaleMode('weeks')" class="px-2 py-1 rounded-lg transition ${ganttScaleMode === 'weeks' ? 'bg-white dark:bg-darkCard text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}" title="Agrupar cabeçalho por Semanas do Mês (1ª Sem, 2ª Sem, 3ª Sem, 4ª Sem...)">
                            Semanas do Mês
                        </button>
                    </div>

                    <button type="button" onclick="openWorkSettingsModal()" class="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition flex items-center gap-1.5" title="Configurar dias úteis padrão, feriados e horas extras">
                        <i class="fa-solid fa-gear text-indigo-500"></i> <span class="hidden sm:inline">Jornada & Feriados</span>
                    </button>
                    <button type="button" onclick="expandOrCollapseAllTasks(true)" class="px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition flex items-center gap-1" title="Expandir subtarefas de todas as tarefas">
                        <i class="fa-solid fa-angles-down text-indigo-500 text-[10px]"></i> <span class="hidden md:inline">Expandir</span>
                    </button>
                    <button type="button" onclick="expandOrCollapseAllTasks(false)" class="px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition flex items-center gap-1" title="Recolher para tarefas macro">
                        <i class="fa-solid fa-angles-up text-slate-400 text-[10px]"></i> <span class="hidden md:inline">Recolher</span>
                    </button>
                    <button type="button" onclick="autoBalanceTeamSubtasksAndHours()" class="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm transition flex items-center gap-1.5">
                        <i class="fa-solid fa-people-arrows"></i> <span class="hidden sm:inline">Balancear Equipe</span>
                    </button>
                </div>
            </div>

            <!-- BARRA DE MOVIMENTAÇÃO TEMPORAL (VISUALIZAR DATAS PASSADAS, HOJE E DATAS FUTURAS) -->
            <div class="p-2.5 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                <!-- Botões de Navegação Rápida (Passado / Hoje / Futuro) -->
                <div class="flex flex-wrap items-center gap-1 shrink-0">
                    <button type="button" onclick="shiftGanttTimelineDays(-7)" class="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold transition flex items-center gap-1 shadow-sm" title="Voltar 7 dias (Datas Passadas)">
                        <i class="fa-solid fa-angles-left text-[10px] text-indigo-500"></i> -7d
                    </button>
                    <button type="button" onclick="shiftGanttTimelineDays(-1)" class="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold transition flex items-center gap-1 shadow-sm" title="Voltar 1 dia">
                        <i class="fa-solid fa-angle-left text-[10px] text-indigo-500"></i> -1d
                    </button>
                    <button type="button" onclick="resetGanttTimelineToToday()" class="px-2.5 py-1 rounded-lg ${ganttDayOffset === 0 ? 'bg-rose-600 text-white border-rose-600' : 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/10'} border font-extrabold transition flex items-center gap-1 shadow-sm" title="Centralizar no Dia e Horário Atual">
                        <i class="fa-solid fa-location-crosshairs text-[10px]"></i> Hoje
                    </button>
                    <button type="button" onclick="shiftGanttTimelineDays(1)" class="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold transition flex items-center gap-1 shadow-sm" title="Avançar 1 dia">
                        +1d <i class="fa-solid fa-angle-right text-[10px] text-indigo-500"></i>
                    </button>
                    <button type="button" onclick="shiftGanttTimelineDays(7)" class="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold transition flex items-center gap-1 shadow-sm" title="Avançar 7 dias (Datas Futuras)">
                        +7d <i class="fa-solid fa-angles-right text-[10px] text-indigo-500"></i>
                    </button>
                </div>

                <!-- Controle Deslizante (Barra de Movimentação Contínua Passado <-> Futuro) -->
                <div class="flex-1 min-w-[140px] flex items-center gap-2 px-1">
                    <span class="text-[10px] font-bold uppercase text-slate-400 shrink-0"><i class="fa-solid fa-clock-rotate-left mr-1"></i>Passado</span>
                    <input type="range" min="-90" max="90" step="1" value="${ganttDayOffset}" oninput="setGanttTimelineOffsetSlider(this.value)" class="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600" title="Arraste para mover a linha do tempo entre datas passadas (-90 dias) e futuras (+90 dias)">
                    <span class="text-[10px] font-bold uppercase text-slate-400 shrink-0">Futuro<i class="fa-solid fa-forward ml-1"></i></span>
                </div>

                <!-- Botões Rápidos (15d, 30d, 60d, 90d) + Seletor Direto de Data Inicial e Escala de Dias Visíveis -->
                <div class="flex flex-wrap items-center gap-1.5 shrink-0">
                    <div class="inline-flex items-center bg-white dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700" title="Alternar rapidamente a janela de visualização para 15, 30, 60 ou 90 dias">
                        ${[15, 30, 60, 90].map(dOpt => `
                            <button type="button" onclick="setGanttTimelineWindowDays(${dOpt})" class="px-2 py-0.5 rounded-md text-[10px] font-extrabold transition ${totalTimelineDays === dOpt ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}">
                                ${dOpt}d
                            </button>
                        `).join('')}
                    </div>
                    <div class="hidden sm:inline-flex items-center gap-1 bg-white dark:bg-slate-900 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700" title="Período exibido atualmente na Timeline">
                        <i class="fa-regular fa-calendar-days text-indigo-500 text-[10px]"></i>
                        <span class="font-bold text-slate-700 dark:text-slate-200 text-[10px]">${rangeStartLabel} até ${rangeEndLabel}</span>
                    </div>
                    <input type="date" value="${viewStartDateInputVal}" onchange="jumpGanttTimelineToDate(this.value)" class="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer focus:outline-none focus:border-indigo-500" title="Ir diretamente para uma data específica">
                    <select onchange="setGanttTimelineWindowDays(this.value)" class="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer focus:outline-none focus:border-indigo-500" title="Quantidade de dias visíveis na janela da Timeline">
                        <option value="7" ${totalTimelineDays === 7 ? 'selected' : ''}>🔭 7 dias</option>
                        <option value="10" ${totalTimelineDays === 10 ? 'selected' : ''}>🔭 10 dias</option>
                        <option value="14" ${totalTimelineDays === 14 ? 'selected' : ''}>🔭 14 dias</option>
                        <option value="15" ${totalTimelineDays === 15 ? 'selected' : ''}>🔭 15 dias</option>
                        <option value="21" ${totalTimelineDays === 21 ? 'selected' : ''}>🔭 21 dias (Semanas)</option>
                        <option value="30" ${totalTimelineDays === 30 ? 'selected' : ''}>🔭 30 dias (Semanas)</option>
                        <option value="60" ${totalTimelineDays === 60 ? 'selected' : ''}>🔭 60 dias (Semanas)</option>
                        <option value="90" ${totalTimelineDays === 90 ? 'selected' : ''}>🔭 90 dias (Semanas)</option>
                    </select>
                </div>
            </div>

            <!-- CONTAINER COM ROLAGEM UNIFICADA E CABEÇALHO DE DATAS SEMPRE VISÍVEL (STICKY TOP-0 + AJUSTE TOTAL NA TELA) -->
            <div class="${ganttFitToScreen ? 'overflow-y-auto overflow-x-hidden' : 'overflow-auto'} max-h-[calc(100vh-220px)] rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-darkCard pb-2 relative w-full" data-scroll-id="gantt_unified_scroll" onscroll="recordContainerScroll(this)">
                <div class="space-y-2.5 p-2 w-full" style="${ganttFitToScreen ? 'width: 100%;' : `min-width: ${190 + 10 + (totalTimelineDays * dayColMinPx)}px;`}">
                    
                    <!-- Cabeçalho de Datas / Semanas do Mês da Timeline (SEMPRE VISÍVEL AO ROLAR A TELA) -->
                    <div class="sticky top-0 z-40 flex items-stretch gap-2.5 bg-white/95 dark:bg-darkCard/95 backdrop-blur-md py-1 border-b border-slate-200 dark:border-slate-800 shadow-sm w-full">
                        <div class="sticky left-0 z-50 w-[185px] sm:w-[200px] shrink-0 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200/90 dark:border-slate-700 flex flex-col justify-center gap-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 shadow-sm">
                            <div class="flex items-center justify-between">
                                <span>Membro / Equipe</span>
                                <span>Carga</span>
                            </div>
                            <div class="text-[9px] font-semibold normal-case text-slate-400 flex items-center justify-between gap-1">
                                <span>Folgas: ${visibleRestDaysCount}d</span>
                                <span class="text-indigo-500 font-bold">${useMonthWeeksHeader ? '📅 Semanas/Mês' : '📅 Diário'}</span>
                            </div>
                        </div>

                        <div class="relative rounded-xl overflow-hidden border border-slate-200/80 dark:border-slate-700/70 bg-slate-100/90 dark:bg-slate-800/90" style="${timelineTrackStyle}">
                            ${useMonthWeeksHeader ? `
                                <!-- MODO SEMANAS DO MÊS (Para 21, 30, 60 e 90 dias ou quando selecionado):
                                     Linha 1 = Semanas do Mês (1ª Sem • Nov, 2ª Sem • Nov...) proporcional aos dias
                                     Linha 2 = Sub-grade compacta dos dias (permite clicar em qualquer dia ou na semana inteira!) -->
                                <div class="flex flex-col w-full">
                                    <!-- Linha 1: Blocos das Semanas do Mês -->
                                    <div class="grid border-b border-slate-200/80 dark:border-slate-700/70" style="grid-template-columns: ${weekBuckets.map(b => `${b.daysCount}fr`).join(' ')};">
                                        ${weekBuckets.map(b => {
                                            const allWeekWorking = b.workingDaysCount === b.daysCount;
                                            const hasWeekWork = b.workingDaysCount > 0;
                                            let weekBg = 'hover:bg-indigo-500/10';
                                            if (b.hasToday) {
                                                weekBg = 'bg-rose-500/10 dark:bg-rose-500/15 ring-1 ring-inset ring-rose-500/30';
                                            } else if (b.overtimeDaysCount > 0) {
                                                weekBg = 'bg-amber-500/10 dark:bg-amber-500/15';
                                            }

                                            return `
                                                <div onclick="toggleTimelineWeekWorkCheckbox('${b.datesCsv}')"
                                                     title="${escapeHtml(b.titleLabel)} (${b.rangeLabel}) — ${b.workingDaysCount}d úteis ativos (${b.workingDaysCount * 8}h)${b.overtimeDaysCount > 0 ? ' • ' + b.overtimeDaysCount + 'd Hora Extra' : ''}. Clique para alternar a semana inteira."
                                                     class="px-1 py-1 text-center border-r last:border-r-0 border-slate-300/80 dark:border-slate-600/70 cursor-pointer select-none transition flex flex-col items-center justify-center min-w-0 overflow-hidden ${weekBg}">
                                                    <div class="flex items-center justify-center gap-1 max-w-full">
                                                        <input type="checkbox" ${hasWeekWork ? 'checked' : ''} onclick="event.stopPropagation(); toggleTimelineWeekWorkCheckbox('${b.datesCsv}')" class="rounded ${allWeekWorking ? 'text-amber-500' : 'text-indigo-600'} w-3 h-3 cursor-pointer shrink-0">
                                                        <span class="text-[10px] font-extrabold truncate ${b.hasToday ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}">
                                                            ${totalTimelineDays >= 60 ? b.shortLabel : b.titleLabel}
                                                        </span>
                                                    </div>
                                                    <div class="text-[8px] font-semibold text-slate-500 dark:text-slate-400 truncate max-w-full">
                                                        ${b.rangeLabel} • <strong class="text-indigo-600 dark:text-indigo-400">${b.workingDaysCount * 8}h</strong>
                                                    </div>
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>

                                    <!-- Linha 2: Sub-barra de Dias Individuais dentro de cada Semana (para precisão visual e clique individual) -->
                                    <div class="grid" style="grid-template-columns: repeat(${totalTimelineDays}, minmax(0, 1fr));">
                                        ${dayColumns.map(col => {
                                            let dayBg = 'hover:bg-indigo-500/20';
                                            if (col.isTodayCol) dayBg = 'bg-rose-500/25 text-rose-700 dark:text-rose-300 font-extrabold';
                                            else if (col.isOvertime) dayBg = 'bg-amber-500/25 text-amber-700 dark:text-amber-300 font-bold';
                                            else if (col.isRestDay) dayBg = 'bg-slate-200/80 dark:bg-slate-800/90 text-rose-400 opacity-75';
                                            else dayBg = 'text-slate-600 dark:text-slate-300';

                                            const tooltipDay = `${col.label} (${col.weekDay}) — ${col.isOvertime ? 'Hora Extra (8h)' : (col.isRestDay ? (col.isHoliday ? 'Feriado: ' + col.holidayName : 'Folga') : 'Dia Útil (8h)')}. Clique para alternar este dia.`;

                                            return `
                                                <div onclick="toggleTimelineDayWorkCheckbox('${col.dateIso}')"
                                                     title="${escapeHtml(tooltipDay)}"
                                                     class="py-0.5 text-center border-r last:border-r-0 border-slate-200/60 dark:border-slate-700/50 cursor-pointer select-none transition text-[8px] leading-tight truncate ${dayBg}">
                                                    ${totalTimelineDays <= 45 ? String(col.dayNum).padStart(2, '0') : (col.dayNum % 2 === 1 || col.isTodayCol ? col.dayNum : '·')}
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                </div>
                            ` : `
                                <!-- MODO DIÁRIO DETALHADO (Para 7, 10, 14 e 15 dias ou quando "Dias" está selecionado) -->
                                <div class="grid" style="grid-template-columns: repeat(${totalTimelineDays}, minmax(${dayColMinPx}px, 1fr));">
                                    ${dayColumns.map(col => {
                                        let cellBg = 'hover:bg-indigo-500/10';
                                        if (col.isTodayCol) {
                                            cellBg = 'bg-rose-500/15 dark:bg-rose-500/20 ring-1 ring-inset ring-rose-500/40';
                                        } else if (col.isOvertime) {
                                            cellBg = 'bg-amber-500/15 dark:bg-amber-500/20 hover:bg-amber-500/25';
                                        } else if (col.isRestDay) {
                                            cellBg = 'bg-slate-200/65 dark:bg-slate-800/80 opacity-80 hover:opacity-100 hover:bg-amber-500/10';
                                        }

                                        let statusColor = 'text-indigo-600 dark:text-indigo-400';
                                        if (col.isOvertime) statusColor = 'text-amber-600 dark:text-amber-400 font-extrabold';
                                        else if (col.isRestDay) statusColor = 'text-rose-500 dark:text-rose-400';

                                        const tooltipText = col.isHoliday
                                            ? `${col.label} — Feriado: ${col.holidayName} (${col.isWorking ? 'Ativo como Hora Extra' : 'Folga Padrão'}). Clique para alternar.`
                                            : (col.isWeekend
                                                ? `${col.label} (${col.weekDay}) — Fim de Semana (${col.isWorking ? 'Ativo como Hora Extra' : 'Folga Padrão'}). Clique para alternar.`
                                                : `${col.label} (${col.weekDay}) — ${col.isWorking ? 'Dia Útil (8h)' : 'Folga'}. Clique para alternar.`);

                                        return `
                                            <div onclick="toggleTimelineDayWorkCheckbox('${col.dateIso}')"
                                                 title="${escapeHtml(tooltipText)}"
                                                 class="px-0.5 py-1.5 text-center border-r last:border-r-0 border-slate-200/70 dark:border-slate-700/60 cursor-pointer select-none transition flex flex-col items-center justify-center gap-0.5 min-w-0 overflow-hidden ${cellBg}">
                                                <div class="flex items-center justify-center gap-1 max-w-full">
                                                    <input type="checkbox" ${col.isWorking ? 'checked' : ''} onclick="event.stopPropagation(); toggleTimelineDayWorkCheckbox('${col.dateIso}')" class="rounded ${col.isOvertime ? 'text-amber-500 focus:ring-amber-500' : 'text-indigo-600 focus:ring-indigo-500'} w-3 h-3 cursor-pointer shrink-0">
                                                    <span class="text-[10px] font-extrabold truncate ${col.isTodayCol ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-200'}">${col.label}</span>
                                                </div>
                                                <div class="text-[8px] sm:text-[9px] font-semibold uppercase leading-tight truncate max-w-full ${statusColor}">
                                                    ${col.weekDay} • ${col.isOvertime ? '⚡Ext' : (col.isRestDay ? (col.isHoliday ? '🏖️Fer' : 'Folga') : '8h')}
                                                </div>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            `}
                            ${nowMetrics.isVisible ? `
                                <!-- Indicador Superior da Linha Vermelha de Data/Hora Atual -->
                                <div class="absolute top-0 bottom-0 pointer-events-none z-30" style="left: ${nowMetrics.percentLeft}%;">
                                    <div class="w-0.5 h-full bg-rose-600 shadow-[0_0_8px_rgba(225,29,72,0.9)]"></div>
                                    <div class="absolute -top-0.5 -translate-x-1/2 px-1 py-0.2 rounded-b bg-rose-600 text-white font-mono text-[8px] font-extrabold shadow whitespace-nowrap">
                                        AGORA ${nowMetrics.dateTimeLabel.split('•')[1].trim()}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
    `;

    userNames.forEach(user => {
        const userGroup = scheduledByUser[user];
        const macros = userGroup.macros;
        const percentDone = userGroup.rawTotalHours > 0 ? Math.round((userGroup.rawDoneHours / userGroup.rawTotalHours) * 100) : 0;

        const visibleRows = [];
        macros.forEach(macro => {
            const isExpanded = expandedGanttMacroSet.has(macro.macroKey) || expandedGanttMacroSet.has(macro.taskId);
            visibleRows.push({
                rowType: 'macro',
                macro,
                isExpanded
            });
            if (isExpanded && macro.hasSubtasks) {
                macro.scheduledSubs.forEach(subItem => {
                    visibleRows.push({
                        rowType: 'subtask',
                        macro,
                        subItem
                    });
                });
            }
        });

        const rowHeight = Math.max(58, (visibleRows.length * 36) + 14);

        html += `
            <div class="flex items-stretch gap-2.5 w-full">
                <div class="sticky left-0 z-30 w-[185px] sm:w-[200px] shrink-0 p-2.5 rounded-xl bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur-sm border border-slate-200/80 dark:border-slate-700/70 flex flex-col justify-between gap-2 shadow-sm">
                    <div class="flex items-center gap-2">
                        <div class="w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-[11px] shadow-sm shrink-0">
                            ${escapeHtml(user.substring(0, 2).toUpperCase())}
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="text-xs font-bold text-slate-800 dark:text-slate-100 truncate" title="${escapeHtml(user)}">${escapeHtml(user)}</div>
                            <div class="text-[10px] text-slate-400 font-semibold">${macros.length} tarefa(s) macro</div>
                        </div>
                    </div>

                    <div class="space-y-1 pt-1 border-t border-slate-200/70 dark:border-slate-700/60">
                        <div class="flex items-center justify-between text-[10px] font-bold">
                            <span class="text-amber-600 dark:text-amber-400"><i class="fa-regular fa-clock mr-1"></i>${userGroup.totalHours}h</span>
                            <span class="px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">${userGroup.totalDays}d (8h)</span>
                        </div>
                        <div class="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                            <div class="bg-gradient-to-r from-indigo-500 to-emerald-500 h-full rounded-full" style="width: ${percentDone}%"></div>
                        </div>
                        <div class="flex justify-between text-[9px] text-slate-400">
                            <span>Concluído: ${userGroup.doneHours}h</span>
                            <span>${percentDone}%</span>
                        </div>
                    </div>
                </div>

                <div class="relative rounded-xl bg-slate-50/70 dark:bg-slate-900/40 border border-slate-200/80 dark:border-slate-800 overflow-hidden transition-all" style="${timelineTrackStyle} height: ${rowHeight}px;">
                    <!-- Colunas de Grade Diária (Alinhadas em proporção 1:1 com o cabeçalho de dias e semanas acima) -->
                    <div class="absolute inset-0 grid pointer-events-none" style="grid-template-columns: repeat(${totalTimelineDays}, minmax(0, 1fr));">
                        ${dayColumns.map((col, cIdx) => {
                            const isWeekEndBorder = new Date(col.colMs).getDay() === 0 || col.dayNum % 7 === 0;
                            return `
                                <div class="h-full border-r last:border-r-0 ${isWeekEndBorder && useMonthWeeksHeader ? 'border-slate-300 dark:border-slate-700' : 'border-dashed border-slate-200/70 dark:border-slate-800/80'} ${col.isTodayCol ? 'bg-rose-500/5 dark:bg-rose-500/10' : (col.isOvertime ? 'bg-amber-500/5 dark:bg-amber-500/10' : (col.isRestDay ? 'bg-slate-200/45 dark:bg-slate-800/40' : (cIdx % 2 === 1 ? 'bg-slate-100/30 dark:bg-slate-800/15' : '')))}"></div>
                            `;
                        }).join('')}
                    </div>

                    ${nowMetrics.isVisible ? `
                        <!-- LINHA VERMELHA VERTICAL CRUZANDO NA DATA E HORÁRIO ATUAL -->
                        <div class="absolute top-0 bottom-0 pointer-events-none z-20" style="left: ${nowMetrics.percentLeft}%;" title="Data e Horário Atual: ${nowMetrics.dateTimeLabel}">
                            <div class="w-0.5 h-full bg-rose-600 shadow-[0_0_8px_rgba(225,29,72,0.85)]"></div>
                            <div class="w-2.5 h-2.5 rounded-full bg-rose-600 border-2 border-white dark:border-slate-900 -translate-x-[4px] -translate-y-1 shadow"></div>
                        </div>
                    ` : ''}
        `;

        const totalSpanMs = totalTimelineDays * DAY_MS;

        visibleRows.forEach((rowObj, rIdx) => {
            const topPx = (rIdx * 36) + 8;

            if (rowObj.rowType === 'macro') {
                const macro = rowObj.macro;
                const isExpanded = rowObj.isExpanded;

                if (macro.endMs <= viewStartMs || macro.startMs >= viewEndMs) {
                    return;
                }

                // A barra usa porcentagem exata da linha do tempo (0% a 100%) para se adaptar perfeitamente a qualquer tamanho de tela!
                const clampedStartMs = Math.max(viewStartMs, macro.startMs);
                const clampedEndMs = Math.min(viewEndMs, macro.endMs);

                const leftPct = Math.max(0, Math.min(100, ((clampedStartMs - viewStartMs) / totalSpanMs) * 100));
                const rawWidthPct = ((clampedEndMs - clampedStartMs) / totalSpanMs) * 100;
                const widthPct = Math.max(0.8, Math.min(100 - leftPct, rawWidthPct));

                let macroBg = 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500';
                if (macro.allCompleted) macroBg = 'bg-emerald-600 hover:bg-emerald-500 opacity-80';
                else if (macro.priority === 'urgente') macroBg = 'bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500';
                else if (macro.priority === 'alta') macroBg = 'bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400';

                const safeKey = escapeHtml(macro.macroKey).replace(/'/g, "\\'");
                const isCompactBar = widthPct < 22;
                const isVeryNarrowBar = widthPct < 10;

                html += `
                    <div onclick="toggleGanttMacroTask('${safeKey}')"
                         class="absolute h-7 rounded-xl shadow-md ${macroBg} text-white flex items-center justify-between gap-1 px-2 text-[11px] font-bold cursor-pointer select-none transition-all hover:shadow-lg z-10 overflow-hidden border ${macro.exceedingSubCount > 0 ? 'border-rose-300 ring-2 ring-rose-500/70' : 'border-white/20'}"
                         style="left: ${leftPct.toFixed(3)}%; width: ${widthPct.toFixed(3)}%; top: ${topPx}px;"
                         title="Tarefa Principal: ${escapeHtml(macro.taskTitle)} | Criada em: ${macro.createdFullLabel} | Vencimento: ${macro.dueFullLabel} | Carga das Subtarefas: ${macro.totalHours}h (${macro.durationDays}d de 8h)${macro.exceedingSubCount > 0 ? ' | ATENÇÃO: ' + macro.exceedingSubCount + ' subtarefa(s) excedem a data de vencimento!' : ''}">
                        
                        <div class="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
                            ${macro.hasSubtasks ? `
                                <span class="w-4 h-4 rounded-md bg-black/25 flex items-center justify-center shrink-0">
                                    <i class="fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'} text-[9px]"></i>
                                </span>
                            ` : `<i class="fa-solid fa-folder text-[10px] opacity-80 shrink-0"></i>`}
                            <span class="truncate ${macro.allCompleted ? 'line-through opacity-85' : ''}">${escapeHtml(macro.taskTitle)}</span>
                        </div>

                        ${!isVeryNarrowBar ? `
                            <div class="flex items-center gap-1 shrink-0">
                                ${!isCompactBar ? `
                                    <!-- Badge com Data de Criação e Data de Vencimento da Tarefa Principal -->
                                    <span class="px-1.5 py-0.2 rounded bg-black/30 text-[9px] font-semibold flex items-center gap-1 whitespace-nowrap" title="Data de Criação (${macro.createdFullLabel}) até Data de Vencimento (${macro.dueFullLabel})">
                                        <i class="fa-regular fa-calendar-plus text-[8px] text-indigo-200"></i>${macro.createdShortLabel}
                                        <i class="fa-solid fa-arrow-right text-[7px] opacity-75"></i>
                                        <i class="fa-regular fa-calendar-check text-[8px] text-amber-200"></i>${macro.dueShortLabel}
                                    </span>
                                ` : `
                                    <span class="px-1 py-0.2 rounded bg-black/30 text-[8px] font-semibold whitespace-nowrap">
                                        ${macro.dueShortLabel}
                                    </span>
                                `}
                                ${macro.simultaneous && !isCompactBar ? `
                                    <span class="px-1 py-0.2 rounded bg-cyan-500/40 border border-cyan-300/40 text-[9px] font-extrabold" title="Execução Simultânea Ativa">
                                        <i class="fa-solid fa-code-branch text-[8px]"></i>
                                    </span>
                                ` : ''}
                                ${macro.exceedingSubCount > 0 ? `
                                    <span class="px-1 py-0.2 rounded bg-rose-700 text-white text-[9px] font-extrabold animate-pulse" title="${macro.exceedingSubCount} subtarefa(s) ultrapassam o vencimento (${macro.dueFullLabel})!">
                                        <i class="fa-solid fa-triangle-exclamation text-[8px] mr-0.5"></i>+${macro.exceedingSubCount}
                                    </span>
                                ` : ''}
                                ${macro.hasSubtasks && !isCompactBar ? `
                                    <span class="px-1.5 py-0.2 rounded bg-black/25 text-[9px] font-extrabold" title="Subtarefas concluídas">
                                        <i class="fa-solid fa-boxes-stacked text-[8px] mr-0.5"></i>${macro.completedCount}/${macro.totalCount}
                                    </span>
                                ` : ''}
                                <span class="px-1.5 py-0.2 rounded bg-black/25 font-mono text-[10px] font-extrabold" title="Soma das horas das subtarefas">
                                    ${macro.totalHours}h
                                </span>
                                <button type="button" onclick="event.stopPropagation(); openTaskModal('${macro.taskId}')" class="w-4 h-4 rounded hover:bg-white/20 flex items-center justify-center text-[9px]" title="Editar Tarefa Principal">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                            </div>
                        ` : ''}
                    </div>
                `;
            } else {
                const item = rowObj.subItem;
                if (item.endMs <= viewStartMs || item.startMs >= viewEndMs) {
                    return;
                }

                // A barra da Subtarefa usa a porcentagem exata da escala diária/semanal,
                // e exibe o RÓTULO COMPLETO AO LADO da barra quando a barra é curta (ex: 1h, 2h, 4h),
                // garantindo 100% de leitura do nome, checkbox e botões (- / h / +) sem distorcer a duração!
                const clampedStartMs = Math.max(viewStartMs, item.startMs);
                const clampedEndMs = Math.min(viewEndMs, item.endMs);

                const leftPct = Math.max(0, Math.min(100, ((clampedStartMs - viewStartMs) / totalSpanMs) * 100));
                const rawWidthPct = ((clampedEndMs - clampedStartMs) / totalSpanMs) * 100;
                const widthPct = Math.max(1.2, Math.min(100 - leftPct, rawWidthPct));

                let subBarBg = 'bg-slate-700 dark:bg-slate-700 hover:bg-slate-600 border-l-4 border-l-indigo-400';
                let extPillBorder = 'border-slate-300 dark:border-slate-700 bg-white/95 dark:bg-slate-800/95 text-slate-700 dark:text-slate-100';
                if (item.completed) {
                    subBarBg = 'bg-emerald-600 hover:bg-emerald-500 border-l-4 border-l-emerald-200';
                    extPillBorder = 'border-emerald-500/35 bg-emerald-500/10 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200';
                } else if (item.exceedsDeadline) {
                    subBarBg = 'bg-rose-600 hover:bg-rose-500 border-l-4 border-l-amber-300 ring-1 ring-rose-400';
                    extPillBorder = 'border-rose-500/45 bg-rose-500/10 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200';
                }

                const adjustMinusCall = `adjustCardSubtaskHours('${item.taskId}', ${item.subIdx}, -0.5)`;
                const adjustPlusCall  = `adjustCardSubtaskHours('${item.taskId}', ${item.subIdx}, 0.5)`;
                const toggleDoneCall  = `toggleSubtaskStatus('${item.taskId}', ${item.subIdx})`;

                // Se a barra tiver largura suficiente (>= 24% da linha do tempo), renderiza texto e controles dentro da barra.
                // Se a barra for curta (< 24%), mantém a barra na largura exata da sua duração e exibe o rótulo legível ao lado!
                const canFitInsideBar = widthPct >= 24;
                const placeLabelOnLeft = !canFitInsideBar && (leftPct + widthPct > 65);
                const tooltipSub = `Subtarefa: ${item.itemTitle} | Duração: ${item.hours}h (${item.durationDays}d de 8h)${item.exceedsDeadline ? ' | ⚠️ EXCEDE O PRAZO FINAL DA TAREFA (' + formatDisplayDate(item.dueDate) + ') — Término previsto: ' + item.endFormatted : ''}`;

                if (canFitInsideBar) {
                    html += `
                        <div class="absolute h-6 rounded-lg shadow-sm ${subBarBg} text-white flex items-center justify-between gap-1.5 px-2 text-[10px] font-medium transition-all z-10 hover:z-30 overflow-hidden"
                             style="left: ${leftPct.toFixed(3)}%; width: ${widthPct.toFixed(3)}%; top: ${topPx + 2}px;"
                             title="${escapeHtml(tooltipSub)}">
                            
                            <div class="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer overflow-hidden" onclick="openTaskModalAndFocusSubtask('${item.taskId}', ${item.subIdx})">
                                <input type="checkbox" ${item.completed ? 'checked' : ''} onclick="event.stopPropagation(); ${toggleDoneCall}" class="rounded text-emerald-500 w-3 h-3 cursor-pointer shrink-0">
                                <span class="truncate font-semibold ${item.completed ? 'line-through opacity-80' : ''}">${escapeHtml(item.itemTitle)}</span>
                            </div>

                            <div class="flex items-center gap-1 shrink-0" onclick="event.stopPropagation()">
                                ${item.exceedsDeadline ? `
                                    <span class="px-1 py-0.2 rounded bg-amber-400 text-slate-900 font-extrabold text-[8px]" title="Ultrapassa o vencimento em ${item.endFormatted}">
                                        ⚠️${item.endFormatted}
                                    </span>
                                ` : ''}
                                <div class="inline-flex items-center gap-0.5 bg-black/30 rounded px-1 py-0.2 shrink-0">
                                    <button type="button" onclick="${adjustMinusCall}" class="w-3.5 h-3.5 rounded hover:bg-white/20 flex items-center justify-center font-extrabold text-[9px]" title="Reduzir 0.5h">-</button>
                                    <span class="font-mono text-[9px] font-extrabold px-0.5 text-amber-300">${item.hours}h</span>
                                    <button type="button" onclick="${adjustPlusCall}" class="w-3.5 h-3.5 rounded hover:bg-white/20 flex items-center justify-center font-extrabold text-[9px]" title="Aumentar 0.5h">+</button>
                                </div>
                            </div>
                        </div>
                    `;
                } else {
                    html += `
                        <!-- Barra exata de duração da subtarefa na escala de tempo -->
                        <div onclick="openTaskModalAndFocusSubtask('${item.taskId}', ${item.subIdx})"
                             class="absolute h-6 rounded-md shadow-sm ${subBarBg} text-white flex items-center justify-center cursor-pointer transition-all z-10 hover:z-30"
                             style="left: ${leftPct.toFixed(3)}%; width: ${widthPct.toFixed(3)}%; min-width: 10px; top: ${topPx + 2}px;"
                             title="${escapeHtml(tooltipSub)}">
                            ${widthPct >= 3.2 ? `<span class="font-mono text-[8px] font-extrabold leading-none truncate px-0.5">${item.hours}h</span>` : ''}
                        </div>

                        <!-- Rótulo externo completo e interativo da Subtarefa (sempre visível e legível ao lado da barra!) -->
                        <div class="absolute h-6 flex items-center gap-1.5 px-2 rounded-lg border shadow-sm backdrop-blur-sm text-[10px] font-semibold transition-all z-20 hover:z-40 max-w-[340px] sm:max-w-[440px] ${extPillBorder}"
                             style="${placeLabelOnLeft ? `right: ${(100 - leftPct + 0.5).toFixed(3)}%;` : `left: ${(leftPct + widthPct + 0.5).toFixed(3)}%;`} top: ${topPx + 2}px;"
                             title="${escapeHtml(tooltipSub)}">
                            
                            <input type="checkbox" ${item.completed ? 'checked' : ''} onclick="event.stopPropagation(); ${toggleDoneCall}" class="rounded text-emerald-600 w-3 h-3 cursor-pointer shrink-0">
                            
                            <span onclick="openTaskModalAndFocusSubtask('${item.taskId}', ${item.subIdx})"
                                  class="truncate cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 ${item.completed ? 'line-through opacity-65' : ''}">
                                ${escapeHtml(item.itemTitle)}
                            </span>
                            ${item.subIdx >= 0 && isCurrentUserAdmin ? `
                                <select onchange="event.stopPropagation(); updateCardSubtaskAssignee('${item.taskId}', ${item.subIdx}, this.value)"
                                        onclick="event.stopPropagation()"
                                        title="Designar subtarefa para outro membro (o tempo dela será redistribuído entre as subtarefas pendentes restantes)"
                                        class="px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-[9px] font-bold text-indigo-600 dark:text-indigo-300 cursor-pointer max-w-[82px] truncate shrink-0">
                                    ${buildMemberSelectOptionsHTML(user, true, '👤 Membro')}
                                </select>
                            ` : ''}

                            ${item.exceedsDeadline ? `
                                <span class="px-1 py-0.2 rounded bg-rose-600 text-white font-extrabold text-[8px] shrink-0" title="Ultrapassa o vencimento em ${item.endFormatted}">
                                    ⚠️${item.endFormatted}
                                </span>
                            ` : ''}

                            <div class="inline-flex items-center gap-0.5 bg-slate-200/80 dark:bg-slate-700/90 text-slate-800 dark:text-slate-100 rounded px-1 py-0.2 shrink-0" onclick="event.stopPropagation()">
                                <button type="button" onclick="${adjustMinusCall}" class="w-3.5 h-3.5 rounded hover:bg-indigo-500 hover:text-white flex items-center justify-center font-extrabold text-[9px] transition" title="Reduzir 0.5h">-</button>
                                <span class="font-mono text-[9px] font-extrabold px-0.5 text-amber-600 dark:text-amber-400">${item.hours}h</span>
                                <button type="button" onclick="${adjustPlusCall}" class="w-3.5 h-3.5 rounded hover:bg-indigo-500 hover:text-white flex items-center justify-center font-extrabold text-[9px] transition" title="Aumentar 0.5h">+</button>
                            </div>
                        </div>
                    `;
                }
            }
        });

        html += `
                </div>
            </div>
        `;
    });

    html += `
                </div>
            </div>
        </div>
    `;

    containerEl.innerHTML = html;
}

// =========================================================================
// MOTOR DE DIMENSIONAMENTO LATERAL DAS JANELAS SUSPENSAS (MODAIS & POPUPS)
// Permite arrastar as bordas esquerda/direita de qualquer janela suspensa,
// dar duplo clique na alça para restaurar o tamanho original e persistir
// as larguras escolhidas no localStorage.
// =========================================================================
const MODAL_WIDTHS_STORAGE_KEY = 'taskflow_pro_modal_widths_v1';

function getSavedModalWidths() {
    try {
        return JSON.parse(localStorage.getItem(MODAL_WIDTHS_STORAGE_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function saveModalCustomWidth(modalId, widthPx) {
    if (!modalId) return;
    try {
        const map = getSavedModalWidths();
        if (widthPx === null) {
            delete map[modalId];
        } else {
            map[modalId] = Math.round(widthPx);
        }
        localStorage.setItem(MODAL_WIDTHS_STORAGE_KEY, JSON.stringify(map));
    } catch (e) {}
}

function attachLateralResizersToModal(modalOverlayEl) {
    if (!modalOverlayEl || modalOverlayEl.nodeType !== 1) return;
    const modalId = modalOverlayEl.id || '';
    if (!modalId.endsWith('Modal')) return;

    const dialogBox = modalOverlayEl.firstElementChild;
    if (!dialogBox || dialogBox.dataset.lateralResizableInit === 'true') return;

    dialogBox.dataset.lateralResizableInit = 'true';
    dialogBox.classList.add('tf-resizable-modal-box');

    // Aplica largura salva anteriormente se existir
    const savedWidths = getSavedModalWidths();
    if (savedWidths[modalId]) {
        const clamped = Math.max(320, Math.min(window.innerWidth * 0.96, Number(savedWidths[modalId])));
        dialogBox.style.width = `${clamped}px`;
        dialogBox.style.maxWidth = '96vw';
    }

    // Cria alça lateral esquerda e direita
    ['left', 'right'].forEach(side => {
        const handle = document.createElement('div');
        handle.className = `tf-modal-resize-handle tf-modal-resize-handle-${side}`;
        handle.title = 'Arraste para dimensionar lateralmente a janela (Duplo clique para restaurar largura padrão)';
        handle.innerHTML = `<div class="tf-modal-resize-grip"></div>`;

        // Evita fechar o modal se clicar na alça
        handle.addEventListener('click', (e) => e.stopPropagation());

        // Duplo clique restaura a largura padrão da janela suspensa
        handle.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dialogBox.style.width = '';
            dialogBox.style.maxWidth = '';
            saveModalCustomWidth(modalId, null);
            if (typeof showToast === 'function') {
                showToast('Largura padrão da janela restaurada.', 'info');
            }
        });

        handle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startRect = dialogBox.getBoundingClientRect();
            const startWidth = startRect.width;

            handle.classList.add('is-resizing');
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';

            const onMouseMove = (moveEvt) => {
                const deltaX = moveEvt.clientX - startX;
                // Como o modal é centralizado com flex (justify-center), expandir 1px de um lado cresce simetricamente (* 2)
                const rawNewWidth = side === 'right'
                    ? startWidth + (deltaX * 2)
                    : startWidth - (deltaX * 2);

                const maxAllowed = Math.floor(window.innerWidth * 0.96);
                const newWidth = Math.max(320, Math.min(maxAllowed, rawNewWidth));

                dialogBox.style.maxWidth = '96vw';
                dialogBox.style.width = `${newWidth}px`;
            };

            const onMouseUp = () => {
                handle.classList.remove('is-resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                const finalRect = dialogBox.getBoundingClientRect();
                saveModalCustomWidth(modalId, finalRect.width);
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });

        // Suporte a dispositivos Touch (tablets / telas sensíveis ao toque)
        handle.addEventListener('touchstart', (e) => {
            if (!e.touches || e.touches.length !== 1) return;
            e.stopPropagation();
            const startX = e.touches[0].clientX;
            const startWidth = dialogBox.getBoundingClientRect().width;
            handle.classList.add('is-resizing');

            const onTouchMove = (moveEvt) => {
                if (!moveEvt.touches || moveEvt.touches.length !== 1) return;
                const deltaX = moveEvt.touches[0].clientX - startX;
                const rawNewWidth = side === 'right'
                    ? startWidth + (deltaX * 2)
                    : startWidth - (deltaX * 2);
                const maxAllowed = Math.floor(window.innerWidth * 0.96);
                const newWidth = Math.max(320, Math.min(maxAllowed, rawNewWidth));
                dialogBox.style.maxWidth = '96vw';
                dialogBox.style.width = `${newWidth}px`;
            };

            const onTouchEnd = () => {
                handle.classList.remove('is-resizing');
                saveModalCustomWidth(modalId, dialogBox.getBoundingClientRect().width);
                window.removeEventListener('touchmove', onTouchMove);
                window.removeEventListener('touchend', onTouchEnd);
            };

            window.addEventListener('touchmove', onTouchMove, { passive: true });
            window.addEventListener('touchend', onTouchEnd);
        }, { passive: true });

        dialogBox.appendChild(handle);
    });
}

function initAllResizableModals() {
    document.querySelectorAll('[id$="Modal"]').forEach(modalEl => {
        attachLateralResizersToModal(modalEl);
    });

    // Observa também modais criados dinamicamente (como workSettingsModal e subtaskHoursDecisionModal)
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node && node.nodeType === 1) {
                    if (node.id && node.id.endsWith('Modal')) {
                        attachLateralResizersToModal(node);
                    }
                    node.querySelectorAll?.('[id$="Modal"]').forEach(innerModal => {
                        attachLateralResizersToModal(innerModal);
                    });
                }
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllResizableModals);
} else {
    initAllResizableModals();
}

