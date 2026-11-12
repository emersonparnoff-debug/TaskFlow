// =========================================================================
// 4. js/excel-importer.js — Importador de Pedidos de Engenharia (.XLS/.XLSX)
// =========================================================================

/**************************************************************
 * 11. IMPORTADOR DE PEDIDO (.XLS / .XLSX):
 *     PEDIDO = 1 TAREFA | CADA ITEM = 1 SUBTAREFA (SEM WORKFLOW)
 **************************************************************/
let parsedExcelOrder = null;

function formatSubtaskFromOrderItem(it) {
    const idStr = String(it.itemId).padStart(2, '0');
    const codPart = it.codTer ? ` [${it.codTer}]` : '';
    // Pega apenas a parte principal do nome antes dos parênteses para ficar bem curto e limpo
    let shortDesc = (it.desc || '').split('(')[0].trim();
    if (!shortDesc) shortDesc = it.desc;
    return `[#${idStr} • ${it.qtd}${it.unid}]${codPart} ${shortDesc}`;
}

function resetExcelImportModalState() {
    parsedExcelOrder = null;
    const fileInp = document.getElementById('excelFileInput');
    if (fileInp) fileInp.value = '';

    const titleInp = document.getElementById('importOrderTitleInput');
    if (titleInp) titleInp.value = '';

    const descInp = document.getElementById('importOrderDescInput');
    if (descInp) descInp.value = '';

    const macroInp = document.getElementById('excelMacroTotalHoursInput');
    if (macroInp) macroInp.value = '';

    const batchInp = document.getElementById('excelBatchSubtaskHoursInput');
    if (batchInp) batchInp.value = '';

    const tbody = document.getElementById('excelPreviewTableBody');
    if (tbody) tbody.innerHTML = '';

    const countLbl = document.getElementById('excelPreviewCountLabel');
    if (countLbl) countLbl.textContent = '0 subtarefas selecionadas';

    const cfgSec = document.getElementById('excelTaskConfigSection');
    if (cfgSec) cfgSec.classList.add('hidden');

    const prevCont = document.getElementById('excelPreviewContainer');
    if (prevCont) prevCont.classList.add('hidden');

    const confirmBtn = document.getElementById('confirmExcelImportBtn');
    if (confirmBtn) confirmBtn.disabled = true;
}

function openExcelImportModal() {
    if (!hasUserPermission('canCreate')) {
        showToast('Você não possui permissão para importar ou criar tarefas.', 'error');
        return;
    }
    resetExcelImportModalState();
    const dueEl = document.getElementById('importDefaultDueDate');
    if (dueEl) dueEl.value = getLocalDateStr(7);
    const authEl = document.getElementById('importDefaultAuthor');
    if (authEl) authEl.value = currentAuthor || '';
    document.getElementById('excelImportModal').classList.remove('hidden');
}

function closeExcelImportModal() {
    resetExcelImportModalState();
    document.getElementById('excelImportModal').classList.add('hidden');
}

function populateOrderTaskHeaderFields(orderObj) {
    const titleEl = document.getElementById('importOrderTitleInput');
    const descEl  = document.getElementById('importOrderDescInput');

    const parts = [
        orderObj.orderNumber ? `Pedido #${orderObj.orderNumber}` : 'Pedido',
        orderObj.clientName,
        orderObj.locationName
    ].filter(Boolean);

    if (titleEl) titleEl.value = parts.join(' — ');
    if (descEl) {
        descEl.value = '';
    }
}



function handleExcelFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[firstSheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

            parseEngineeringRows(rows, file.name);
            event.target.value = '';
        } catch (err) {
            showToast('Erro ao ler a planilha Excel: ' + err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function parseEngineeringRows(rows, fileName) {
    if (!rows || rows.length < 4) {
        showToast('A planilha parece estar vazia ou fora do padrão.', 'error');
        return;
    }

    // Lê o cabeçalho do pedido na célula A1 (ex: "53696 ; HERING BOSSA NOVO CONCEITO ; COPACABANA - VM ; FILIAL LOJA")
    const rawHeader = String(rows[0]?.[0] || fileName.replace(/\.[^.]+$/, '')).trim();
    const headerParts = rawHeader.split(';').map(s => s.trim());
    const orderNumber  = headerParts[0] || '';
    const clientName   = headerParts[1] || '';
    const locationName = headerParts[2] || '';
    const storeType    = headerParts[3] || '';

    let currentSection = '01 - GERAL';
    const extractedItems = [];

    // Percorre as linhas ignorando completamente as colunas de WORKFLOW (colunas 6 a 17)
    for (let r = 3; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;

        const colId   = row[0];
        const colQtd  = row[1];
        const colUnid = row[2];
        const colCod  = row[3];
        const colDesc = row[4];
        const colRev  = row[5];

        // Linha agrupadora de seção (ex: "01 - COMUNICAÇÃO")
        if (colId !== null && colId !== '' && colQtd === null && colDesc === null) {
            currentSection = String(colId).trim();
            continue;
        }

        // Linha de item do pedido
        if (colId !== null && colDesc !== null && String(colId).toLowerCase() !== 'id') {
            const qtdNum = Number(colQtd) || 0;
            const descClean = String(colDesc).trim();

            extractedItems.push({
                subId: 'xls_sub_' + extractedItems.length + '_' + Date.now(),
                itemId: String(colId).trim(),
                qtd: qtdNum,
                unid: String(colUnid || 'UN').trim(),
                codTer: String(colCod || '').trim(),
                rev: String(colRev || '00').trim() || '00',
                section: currentSection,
                desc: descClean,
                hours: 2,
                selected: qtdNum > 0,
                dependsOn: null
            });
        }
    }

    parsedExcelOrder = {
        rawHeader,
        orderNumber,
        clientName,
        locationName,
        storeType,
        items: extractedItems
    };

    populateOrderTaskHeaderFields(parsedExcelOrder);
    distributeExcelPreviewHours(true);
    renderExcelPreviewTable();
    showToast(`Pedido lido com sucesso (${extractedItems.length} itens encontrados)!`, 'success');
}

function renderExcelPreviewTable() {
    if (!parsedExcelOrder) return;

    const skipZero = document.getElementById('importSkipZeroQty')?.checked;
    const defaultAuthor = (document.getElementById('importDefaultAuthor')?.value || '').trim() || currentAuthor || '';
    document.getElementById('excelTaskConfigSection').classList.remove('hidden');
    document.getElementById('excelInnerTasksTemplateBox')?.classList.remove('hidden');
    document.getElementById('excelPreviewContainer').classList.remove('hidden');

    const tbody = document.getElementById('excelPreviewTableBody');
    let selectedCount = 0;

    parsedExcelOrder.items.forEach((it, idx) => {
        if (!it.subId) it.subId = 'xls_sub_' + idx + '_' + Date.now();
        if (it.assignee === undefined) it.assignee = defaultAuthor;
        const isZero = it.qtd <= 0;
        const checked = skipZero && isZero ? false : it.selected;
        parsedExcelOrder.items[idx].selected = checked;
        if (checked) selectedCount++;
    });

    tbody.innerHTML = parsedExcelOrder.items.map((it, idx) => {
        const isZero = it.qtd <= 0;
        const checked = it.selected;
        const shortCurDesc = formatSubtaskFromOrderItem(it);

        return `
            <tr class="${isZero ? 'opacity-50 bg-rose-500/5' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}">
                <td class="p-2.5 text-center">
                    <input type="checkbox" ${checked ? 'checked' : ''} onchange="togglePreviewItem(${idx}, this.checked)" class="rounded text-indigo-600 w-3.5 h-3.5 cursor-pointer">
                </td>
                <td class="p-2.5 font-mono font-bold">#${escapeHtml(it.itemId)}</td>
                <td class="p-2.5 font-bold ${isZero ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'}">${it.qtd} ${escapeHtml(it.unid)}</td>
                <td class="p-2.5 font-mono text-[11px]">${it.codTer ? `<span class="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold">${escapeHtml(it.codTer)}</span>` : '-'}</td>
                <td class="p-2.5">
                    <div class="font-semibold text-slate-800 dark:text-slate-100">${escapeHtml(shortCurDesc)}</div>
                    <div class="text-[10px] text-slate-400 line-clamp-1">${escapeHtml(it.desc)}</div>
                </td>
                <td class="p-2.5 text-center">
                    <div class="inline-flex items-center gap-1">
                        <input type="number" min="0.1" step="0.1" value="${roundHours1Dec(it.hours, 2)}" onchange="updateExcelPreviewItemHours(${idx}, this.value)" class="w-16 px-1.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[11px] font-mono font-bold text-center text-amber-600 dark:text-amber-400 focus:outline-none focus:border-amber-500">
                        <span class="text-[10px] font-bold text-slate-400">h</span>
                    </div>
                </td>
                <td class="p-2.5">
                    <div class="flex items-center gap-1">
                        <select onchange="updateExcelPreviewItemAssignee(${idx}, this.value)" class="w-full px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[11px] font-medium focus:outline-none focus:border-indigo-500 cursor-pointer">
                            ${buildMemberSelectOptionsHTML(it.assignee || '', isCurrentUserAdmin, '👤 Atribuir membro...', true)}
                        </select>
                        <button type="button" onclick="openMultiMemberPickerModal({ mode: 'excel_item', itemIdx: ${idx}, title: 'Membros — Subtarefa #' + '${escapeHtml(it.itemId)}' })" class="px-1.5 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-600 text-indigo-600 dark:text-indigo-400 hover:text-white border border-indigo-500/25 text-[10px] font-bold transition shrink-0" title="Selecionar mais de um membro para este item">
                            <i class="fa-solid fa-users"></i>
                        </button>
                        <div class="inline-flex flex-col rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-0.5 shrink-0">
                            <button type="button" onclick="moveExcelPreviewItemOrder(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} class="w-3.5 h-3 rounded hover:bg-white dark:hover:bg-slate-700 disabled:opacity-30 text-slate-500 flex items-center justify-center" title="Subir item">
                                <i class="fa-solid fa-caret-up text-[8px]"></i>
                            </button>
                            <button type="button" onclick="moveExcelPreviewItemOrder(${idx}, 1)" ${idx === parsedExcelOrder.items.length - 1 ? 'disabled' : ''} class="w-3.5 h-3 rounded hover:bg-white dark:hover:bg-slate-700 disabled:opacity-30 text-slate-500 flex items-center justify-center" title="Descer item">
                                <i class="fa-solid fa-caret-down text-[8px]"></i>
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    const totalSelectedHours = Math.round(parsedExcelOrder.items.reduce((acc, it) => acc + (it.selected ? (Number(it.hours) || 0) : 0), 0) * 10) / 10;
    const totalDaysEq = (totalSelectedHours / 8).toFixed(1);
    document.getElementById('excelPreviewCountLabel').textContent = `${selectedCount} subtarefas selecionadas • Total: ${formatTotalHours1Dec(totalSelectedHours)}h (${totalDaysEq} dias úteis de 8h)`;
    document.getElementById('confirmExcelImportBtn').disabled = selectedCount === 0;
}

function updateExcelPreviewItemAssignee(idx, newAssignee) {
    if (!parsedExcelOrder || !parsedExcelOrder.items[idx]) return;
    if (newAssignee === '__MULTI_PICKER__') {
        openMultiMemberPickerModal({
            mode: 'excel_item',
            itemIdx: idx,
            title: 'Membros — Subtarefa #' + (parsedExcelOrder.items[idx].itemId || (idx + 1))
        });
        renderExcelPreviewTable();
        return;
    }
    const item = parsedExcelOrder.items[idx];
    const prevAssignee = (item.assignee || document.getElementById('importDefaultAuthor')?.value || currentAuthor || '').trim();
    const cleanNew = (newAssignee || '').trim();
    item.assignee = cleanNew;

    // Se a subtarefa foi designada para outro membro diferente, redistribui o tempo dela entre as subtarefas restantes selecionadas do membro anterior
    if (cleanNew && prevAssignee && normalizeIdentityStr(cleanNew) !== normalizeIdentityStr(prevAssignee)) {
        const freedHours = roundHours1Dec(item.hours, 2);
        const remainingSameOwner = parsedExcelOrder.items.filter((cand, cIdx) =>
            cIdx !== idx &&
            cand.selected &&
            normalizeIdentityStr(cand.assignee || document.getElementById('importDefaultAuthor')?.value || currentAuthor || '') === normalizeIdentityStr(prevAssignee)
        );
        if (remainingSameOwner.length > 0) {
            const extraEach = freedHours / remainingSameOwner.length;
            remainingSameOwner.forEach(s => {
                s.hours = roundHours1Dec((Number(s.hours) || 2) + extraEach, 0.1);
            });
            renderExcelPreviewTable();
            showToast(`Subtarefa #${item.itemId} designada a "${cleanNew}". As ${formatTotalHours1Dec(freedHours)}h dela foram distribuídas entre as ${remainingSameOwner.length} subtarefa(s) restante(s) de "${prevAssignee}"!`, 'info');
            return;
        }
    }
    renderExcelPreviewTable();
}

function distributeExcelMacroTotalHours() {
    if (!parsedExcelOrder || !Array.isArray(parsedExcelOrder.items)) return;
    const activeItems = parsedExcelOrder.items.filter(i => i.selected);
    if (activeItems.length === 0) {
        showToast('Selecione pelo menos 1 subtarefa para distribuir o tempo macro.', 'info');
        return;
    }

    const macroInp = document.getElementById('excelMacroTotalHoursInput');
    const macroTotalVal = parseFloat(String(macroInp?.value || '').replace(',', '.'));
    if (isNaN(macroTotalVal) || macroTotalVal <= 0) {
        // Abre o modal de decisão já focado na aba/opção de Tempo Macro
        distributeExcelPreviewHours(false);
        return;
    }

    const perSub = roundHours1Dec(macroTotalVal / activeItems.length, 0.1);
    parsedExcelOrder.items.forEach(it => {
        if (it.selected) it.hours = perSub;
    });
    const batchInp = document.getElementById('excelBatchSubtaskHoursInput');
    if (batchInp) batchInp.value = perSub;
    renderExcelPreviewTable();
    showToast(`Tempo Macro de ${formatTotalHours1Dec(macroTotalVal)}h distribuído igualmente: ${perSub}h para cada uma das ${activeItems.length} subtarefas!`, 'success');
}

function updateExcelPreviewItemHours(idx, newHoursVal) {
    if (!parsedExcelOrder || !parsedExcelOrder.items[idx]) return;
    const h = roundHours1Dec(newHoursVal, 0.1);
    parsedExcelOrder.items[idx].hours = h;
    renderExcelPreviewTable();
}

function distributeExcelPreviewHours(silent = false, explicitHoursPerSub = null) {
    if (!parsedExcelOrder || !Array.isArray(parsedExcelOrder.items)) return;
    const activeItems = parsedExcelOrder.items.filter(i => i.selected);
    if (activeItems.length === 0) return;

    const dueStr = document.getElementById('importDefaultDueDate')?.value || getLocalDateStr(7);
    const todayStr = getLocalDateStr(0);
    const d1 = new Date(todayStr + 'T00:00:00');
    const d2 = new Date(dueStr + 'T00:00:00');
    const diffDays = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) || 1);
    const totalAvailableHours = diffDays * 8; // 8 horas diárias

    const suggestedHours = roundHours1Dec(totalAvailableHours / activeItems.length, 0.1);

    if (explicitHoursPerSub !== null && !isNaN(parseFloat(explicitHoursPerSub))) {
        const chosenHours = roundHours1Dec(explicitHoursPerSub, 0.1);
        parsedExcelOrder.items.forEach(it => {
            if (it.selected) it.hours = chosenHours;
        });
        if (!silent) {
            renderExcelPreviewTable();
            showToast(`Definido ${formatTotalHours1Dec(chosenHours)}h por subtarefa (${activeItems.length} itens = ${formatTotalHours1Dec(chosenHours * activeItems.length)}h totais).`, 'success');
        }
        return;
    }

    if (!silent && typeof openSubtaskHoursDistributionModal === 'function') {
        const currentSelectedSum = roundHours1Dec(activeItems.reduce((acc, it) => acc + (Number(it.hours) || 2), 0), 0.1);
        openSubtaskHoursDistributionModal({
            title: 'Distribuir Tempo do Pedido (Macro ou por Subtarefa)',
            subtasksCount: activeItems.length,
            suggestedHours,
            suggestedMacroHours: currentSelectedSum || totalAvailableHours,
            diffDays,
            totalAvailableHours,
            initialMode: 'macro',
            onConfirm: (chosenHours, chosenMacroTotal) => {
                const inp = document.getElementById('excelBatchSubtaskHoursInput');
                if (inp) inp.value = chosenHours;
                const macroInp = document.getElementById('excelMacroTotalHoursInput');
                if (macroInp) macroInp.value = chosenMacroTotal;
                distributeExcelPreviewHours(false, chosenHours);
            }
        });
        return;
    }

    // Modo silencioso (ao carregar a planilha inicialmente): preenche a sugestão
    parsedExcelOrder.items.forEach(it => {
        if (it.selected) {
            it.hours = suggestedHours;
        }
    });
}

function togglePreviewItem(idx, state) {
    if (!parsedExcelOrder || !parsedExcelOrder.items[idx]) return;
    parsedExcelOrder.items[idx].selected = state;
    renderExcelPreviewTable();
}

function toggleAllPreviewItems(state) {
    if (!parsedExcelOrder) return;
    parsedExcelOrder.items.forEach(i => { i.selected = state; });
    renderExcelPreviewTable();
}

async function confirmExcelImportTasks() {
    if (!parsedExcelOrder) return;

    const orderTitle = (document.getElementById('importOrderTitleInput').value || '').trim() || parsedExcelOrder.rawHeader || 'Novo Pedido de Engenharia';
    const orderDesc  = (document.getElementById('importOrderDescInput').value || '').trim();
    const category   = 'servico';
    const priority   = document.getElementById('importDefaultPriority').value || 'alta';
    const dueDate    = document.getElementById('importDefaultDueDate').value || getLocalDateStr(7);
    const author     = (document.getElementById('importDefaultAuthor').value || '').trim() || currentAuthor;

    const chosenItems = parsedExcelOrder.items.filter(i => i.selected);
    if (chosenItems.length === 0) {
        showToast('Selecione pelo menos 1 item para criar as subtarefas do pedido.', 'error');
        return;
    }

    // Cada item selecionado vira uma Subtarefa sem tarefas internas automáticas
    const orderSubtasks = chosenItems.map((it, sIdx) => {
        const subAssignee = (it.assignee !== undefined && it.assignee !== '') ? it.assignee : author;
        return {
            id: it.subId || ('sub_' + sIdx + '_' + Date.now()),
            text: formatSubtaskFromOrderItem(it),
            assignee: subAssignee,
            hours: roundHours1Dec(it.hours, 2),
            completed: false,
            isGrouped: Boolean(it.isGrouped || String(it.subId || '').includes('_grp_') || String(it.itemId || '').startsWith('GRP-')),
            groupedCount: Number(it.groupedCount) || 0,
            innerTasks: []
        };
    });

    const totalOrderHours = roundHours1Dec(orderSubtasks.reduce((acc, s) => acc + (Number(s.hours) || 2), 0), 0.1);
    const macroInpVal = parseFloat(String(document.getElementById('excelMacroTotalHoursInput')?.value || '').replace(',', '.'));
    const finalMacroHours = (!isNaN(macroInpVal) && macroInpVal > 0) ? roundHours1Dec(macroInpVal, 0.1) : totalOrderHours;

    const newOrderTask = {
        id: 'pedido_' + String(parsedExcelOrder.orderNumber || 'xls').replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + Date.now(),
        title: orderTitle,
        author,
        desc: orderDesc,
        category,
        priority,
        dueDate,
        status: 'todo',
        estimatedHours: finalMacroHours,
        macroTotalHours: finalMacroHours,
        subtasks: orderSubtasks,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    tasks.unshift(newOrderTask);
    saveLocalCacheOnly();
    closeExcelImportModal();
    renderAll();
    await upsertTaskToCloud(newOrderTask);
    showToast(`Tarefa "${orderTitle}" criada com ${orderSubtasks.length} subtarefas atribuídas!`, 'success');
}


function groupSelectedExcelItems() {
    if (!parsedExcelOrder || !Array.isArray(parsedExcelOrder.items)) return;

    const selectedIndexes = [];
    parsedExcelOrder.items.forEach((it, idx) => {
        if (it.selected) selectedIndexes.push(idx);
    });

    if (selectedIndexes.length < 2) {
        showToast('Marque pelo menos 2 itens na tabela para agrupar em uma única subtarefa.', 'info');
        return;
    }

    let sumHours = 0;
    let sumQtd = 0;
    const descParts = [];
    const idParts = [];
    const codTers = new Set();
    const firstIt = parsedExcelOrder.items[selectedIndexes[0]];

    selectedIndexes.forEach(idx => {
        const it = parsedExcelOrder.items[idx];
        sumHours += Number(it.hours) || 0;
        sumQtd += Number(it.qtd) || 0;
        if (it.itemId) idParts.push('#' + String(it.itemId).padStart(2, '0'));
        if (it.desc) {
            const cleanShort = String(it.desc).split('(')[0].trim() || String(it.desc).trim();
            descParts.push(cleanShort);
        }
        if (it.codTer) codTers.add(it.codTer);
    });

    const groupedItem = {
        subId: 'xls_sub_grp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
        itemId: 'GRP-' + firstIt.itemId,
        qtd: sumQtd || selectedIndexes.length,
        unid: firstIt.unid || 'UN',
        codTer: Array.from(codTers).join('/'),
        rev: firstIt.rev || '00',
        section: firstIt.section,
        desc: `[AGRUPADO ${idParts.join(', ')}] ` + descParts.join(' + '),
        hours: roundHours1Dec(sumHours, 0.1),
        selected: true,
        isGrouped: true,
        groupedCount: selectedIndexes.length,
        assignee: firstIt.assignee,
        dependsOn: null
    };

    for (let i = selectedIndexes.length - 1; i >= 0; i--) {
        parsedExcelOrder.items.splice(selectedIndexes[i], 1);
    }

    parsedExcelOrder.items.splice(selectedIndexes[0], 0, groupedItem);
    renderExcelPreviewTable();
    showToast(`${selectedIndexes.length} itens agrupados em uma única subtarefa (${formatTotalHours1Dec(sumHours)}h)!`, 'success');
}
