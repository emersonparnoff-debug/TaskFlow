// =========================================================================
// 2. js/storage.js — Persistência 100% Exclusiva no Google Firebase Cloud Firestore
//    (Zero Armazenamento de Tarefas/Salas/Usuários no Navegador)
// =========================================================================

// Memória volátil em execução (espelho exclusivo do Firebase Cloud Firestore)
let inMemoryRoomsMap = {};
let inMemoryUsersMap = {};

// Limpa resíduos antigos de banco de dados do localStorage do navegador
function purgeLegacyBrowserDatabaseCache() {
    try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (
                k && (
                    k.startsWith('taskflow_pro_tasks_') ||
                    k === 'taskflow_pro_unified_tasks_v8' ||
                    k === LOCAL_ROOM_CONFIG_KEY ||
                    k === LOCAL_USERS_CONFIG_KEY ||
                    k === 'taskflow_pro_deleted_ids_v1'
                )
            ) {
                keysToRemove.push(k);
            }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) {}
}

/**************************************************************
 * 3. ROOM CONFIGS (EM MEMÓRIA + FIREBASE FIRESTORE)
 **************************************************************/
function getLocalRoomConfigs() {
    return inMemoryRoomsMap;
}

function saveLocalRoomConfig(roomName, configObj) {
    if (!roomName) return;
    const key = String(roomName).toLowerCase();
    inMemoryRoomsMap[key] = {
        ...(inMemoryRoomsMap[key] || {}),
        ...configObj,
        id: key,
        roomName: (configObj.roomName || roomName).toUpperCase()
    };
}

function removeLocalRoomConfig(roomName) {
    if (!roomName) return;
    const key = String(roomName).toLowerCase();
    delete inMemoryRoomsMap[key];
}

// Converte qualquer ID de tarefa (mesmo que contenha "/" como "pedido_52453/5_17939") em um ID seguro para o Firestore
function getSafeFirestoreDocId(rawId) {
    return String(rawId || '').trim().replace(/[\/#?\[\]]/g, '_');
}

/**************************************************************
 * 5. MOTOR 100% FIREBASE CLOUD FIRESTORE (SEM CACHE LOCAL)
 **************************************************************/
function getActiveFirebaseConfig() {
    try {
        const savedRaw = localStorage.getItem(FIREBASE_CUSTOM_CONFIG_KEY);
        if (savedRaw) {
            const parsed = JSON.parse(savedRaw);
            if (parsed && parsed.apiKey && parsed.projectId) {
                return parsed;
            }
        }
    } catch (e) {}
    if (typeof DEFAULT_FIREBASE_CONFIG !== 'undefined' && DEFAULT_FIREBASE_CONFIG.apiKey && DEFAULT_FIREBASE_CONFIG.projectId) {
        return DEFAULT_FIREBASE_CONFIG;
    }
    return null;
}

function parseFlexibleFirebaseConfigInput(rawText) {
    if (!rawText || !String(rawText).trim()) return null;
    let txt = String(rawText).trim();

    const firstBrace = txt.indexOf('{');
    const lastBrace = txt.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        txt = txt.substring(firstBrace, lastBrace + 1);
    }

    try {
        return JSON.parse(txt);
    } catch (e) {
        try {
            const normalizedJson = txt
                .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":')
                .replace(/'/g, '"')
                .replace(/,\s*}/g, '}');
            return JSON.parse(normalizedJson);
        } catch (err2) {
            return null;
        }
    }
}

function initFirebase() {
    purgeLegacyBrowserDatabaseCache();

    const cfg = getActiveFirebaseConfig();
    if (!cfg || !cfg.apiKey || !cfg.projectId) {
        db = null;
        firebaseConnected = false;
        updateCloudStatusUI('error');
        return false;
    }

    if (typeof firebase === 'undefined' || !firebase.firestore) {
        db = null;
        firebaseConnected = false;
        updateCloudStatusUI('error');
        return false;
    }

    try {
        updateCloudStatusUI('connecting');
        if (!firebase.apps.length) {
            firebase.initializeApp(cfg);
        }
        db = firebase.firestore();
        firebaseConnected = true;
        updateCloudStatusUI('synced');
        setupGlobalUsersAndRoomsRealtimeListeners();
        return true;
    } catch (err) {
        console.error('Erro ao inicializar Firebase:', err);
        db = null;
        firebaseConnected = false;
        updateCloudStatusUI('error');
        return false;
    }
}

function updateCloudStatusUI(state) {
    const badge = document.getElementById('cloudStatusBadge');
    const dot = document.getElementById('cloudStatusDot');
    const text = document.getElementById('cloudStatusText');
    const adminBadge = document.getElementById('fbAdminConfigStatusBadge');

    if (!badge || !dot || !text) return;

    const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const cfg = getActiveFirebaseConfig();

    if (state === 'connecting') {
        badge.className = 'hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 shrink-0 cursor-pointer transition';
        dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping';
        text.textContent = 'Conectando ao Firebase...';
        badge.title = 'Conectando ao Google Firebase Cloud Firestore...';
        return;
    }

    if (firebaseConnected && db && state !== 'error') {
        badge.className = 'hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 shrink-0 cursor-pointer transition';
        dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse';
        text.textContent = `Firebase (${cfg?.projectId || 'Ativo'})`;
        badge.title = `100% Nuvem Firebase (${cfg?.projectId}) • Sem armazenamento local no navegador • Última sinc: ${timeStr}`;
        if (adminBadge) {
            adminBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30';
            adminBadge.innerHTML = `<i class="fa-solid fa-cloud-bolt mr-1"></i>100% Firebase (${escapeHtml(cfg?.projectId || 'Ativo')})`;
        }
    } else {
        badge.className = 'hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 shrink-0 cursor-pointer transition';
        dot.className = 'w-1.5 h-1.5 rounded-full bg-rose-500';
        text.textContent = ' Sem Conexão Firebase';
        badge.title = 'Sem conexão com o Firebase. Clique para revisar as credenciais do Firebase.';
        if (adminBadge) {
            adminBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30';
            adminBadge.textContent = 'Desconectado do Firebase';
        }
    }
}

function setupGlobalUsersAndRoomsRealtimeListeners() {
    if (!db || !firebaseConnected) return;

    // Listener em tempo real para Contas de Usuários e Permissões (direto do Firebase)
    if (firestoreUsersUnsubscribe) firestoreUsersUnsubscribe();
    firestoreUsersUnsubscribe = db.collection(USERS_CONFIG_COLLECTION).onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            const docData = change.doc.data();
            const docId = String(change.doc.id).toLowerCase();
            if (change.type === 'removed') {
                delete inMemoryUsersMap[docId];
            } else if (docData) {
                inMemoryUsersMap[docId] = { ...docData, id: docId };
            }
        });
        if (typeof fetchAllUsersFromCloud === 'function') {
            fetchAllUsersFromCloud();
        }
    }, err => {
        console.warn('Aviso listener de usuários Firestore:', err);
    });

    // Listener em tempo real para Salas criadas (direto do Firebase)
    if (firestoreRoomsUnsubscribe) firestoreRoomsUnsubscribe();
    firestoreRoomsUnsubscribe = db.collection(ROOMS_CONFIG_COLLECTION).onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            const docData = change.doc.data();
            const docId = String(change.doc.id).toLowerCase();
            if (change.type === 'removed') {
                delete inMemoryRoomsMap[docId];
            } else if (docData) {
                inMemoryRoomsMap[docId] = { ...docData, id: docId };
            }
        });
        if (typeof renderAdminQuickRoomSwitcher === 'function') {
            renderAdminQuickRoomSwitcher();
        }
    }, err => {
        console.warn('Aviso listener de salas Firestore:', err);
    });
}

function setupFirestoreRealtimeListener() {
    if (!db || !firebaseConnected) {
        updateCloudStatusUI('error');
        return;
    }

    if (firestoreTasksUnsubscribe) {
        firestoreTasksUnsubscribe();
        firestoreTasksUnsubscribe = null;
    }

    firestoreTasksUnsubscribe = db.collection(UNIFIED_TASKS_COLLECTION).onSnapshot(snapshot => {
        const cloudTasks = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data && data.id) {
                cloudTasks.push(data);
            }
        });

        isApplyingRemoteUpdate = true;
        tasks = cloudTasks;
        renderAll();
        updateCloudStatusUI('synced');
        isApplyingRemoteUpdate = false;
    }, err => {
        console.error('Erro no listener de tarefas do Firestore:', err);
        updateCloudStatusUI('error');
    });
}

async function fetchTasksViaRestFallback() {
    if (!db || !firebaseConnected) {
        updateCloudStatusUI('error');
        return false;
    }
    try {
        const snap = await db.collection(UNIFIED_TASKS_COLLECTION).get();
        const cloudList = [];
        snap.forEach(doc => {
            const d = doc.data();
            if (d && d.id) cloudList.push(d);
        });
        tasks = cloudList;
        renderAll();
        updateCloudStatusUI('synced');
        return true;
    } catch (e) {
        console.error('Erro ao buscar tarefas do Firebase:', e);
        updateCloudStatusUI('error');
        return false;
    }
}

async function deleteTaskViaRest(taskId) {
    return await removeTaskFromCloud(taskId);
}

async function upsertTaskToCloud(taskObj) {
    if (!taskObj || !taskObj.id) return false;
    taskObj.updatedAt = Date.now();

    if (!db || !firebaseConnected) {
        showToast('Erro: Firebase não está conectado! A tarefa não pôde ser salva na nuvem.', 'error');
        updateCloudStatusUI('error');
        return false;
    }

    try {
        const safeDocId = getSafeFirestoreDocId(taskObj.id);
        taskObj.id = safeDocId;
        const cleanData = JSON.parse(JSON.stringify(taskObj));
        await db.collection(UNIFIED_TASKS_COLLECTION).doc(safeDocId).set(cleanData, { merge: true });
        updateCloudStatusUI('synced');
        return true;
    } catch (err) {
        console.error('Erro ao salvar tarefa no Firestore:', err);
        showToast('Erro ao gravar no Firebase: ' + (err.message || err), 'error');
        updateCloudStatusUI('error');
        return false;
    }
}

async function removeTaskFromCloud(taskId) {
    tasks = tasks.filter(t => t.id !== taskId && getSafeFirestoreDocId(t.id) !== getSafeFirestoreDocId(taskId));

    if (!db || !firebaseConnected || !taskId) {
        updateCloudStatusUI('error');
        return false;
    }

    try {
        const safeDocId = getSafeFirestoreDocId(taskId);
        await db.collection(UNIFIED_TASKS_COLLECTION).doc(safeDocId).delete();
        if (String(taskId) !== safeDocId) {
            await db.collection(UNIFIED_TASKS_COLLECTION).doc(String(taskId)).delete().catch(() => {});
        }
        updateCloudStatusUI('synced');
        return true;
    } catch (err) {
        console.error('Erro ao remover tarefa do Firestore:', err);
        updateCloudStatusUI('error');
        return false;
    }
}

async function syncLocalToCloud() {
    if (!db || !firebaseConnected) {
        showToast('Sem conexão com o Firebase Firestore!', 'error');
        updateCloudStatusUI('error');
        return false;
    }

    try {
        const batch = db.batch();
        (tasks || []).forEach(t => {
            if (t && t.id) {
                const safeDocId = getSafeFirestoreDocId(t.id);
                t.id = safeDocId;
                const ref = db.collection(UNIFIED_TASKS_COLLECTION).doc(safeDocId);
                batch.set(ref, JSON.parse(JSON.stringify(t)), { merge: true });
            }
        });
        await batch.commit();
        updateCloudStatusUI('synced');
        return true;
    } catch (err) {
        console.error('Erro ao sincronizar lote com o Firestore:', err);
        showToast('Erro ao salvar lote no Firebase: ' + (err.message || err), 'error');
        updateCloudStatusUI('error');
        return false;
    }
}

// Funções de Configuração do Firebase no Painel do Administrador
function loadFirebaseConfigIntoModalUI() {
    const inp = document.getElementById('fbConfigJsonInput');
    if (!inp) return;
    const cfg = getActiveFirebaseConfig();
    if (cfg && cfg.apiKey && cfg.projectId) {
        inp.value = JSON.stringify(cfg, null, 2);
    } else {
        inp.value = '';
    }
    updateCloudStatusUI(firebaseConnected ? 'synced' : 'error');
}

async function saveAndConnectFirebaseFromModal() {
    const inp = document.getElementById('fbConfigJsonInput');
    const rawVal = (inp?.value || '').trim();
    const parsed = parseFlexibleFirebaseConfigInput(rawVal);

    if (!parsed || !parsed.apiKey || !parsed.projectId) {
        showToast('Configuração inválida! Certifique-se de incluir pelo menos "apiKey" e "projectId" do seu projeto Firebase.', 'error');
        return;
    }

    localStorage.setItem(FIREBASE_CUSTOM_CONFIG_KEY, JSON.stringify(parsed));

    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
        try {
            await Promise.all(firebase.apps.map(app => app.delete()));
        } catch (e) {}
    }

    const ok = initFirebase();
    if (ok) {
        setupFirestoreRealtimeListener();
        await fetchTasksViaRestFallback();
        showToast(`Conectado exclusivamente ao Firebase (${parsed.projectId}) em tempo real!`, 'success');
    } else {
        showToast('Não foi possível conectar ao Firebase. Verifique as credenciais informadas.', 'error');
    }
}

async function disconnectFirebaseAndUseLocal() {
    showToast('O sistema está configurado para operar 100% no Firebase (armazenamento local no navegador desativado).', 'info');
}

async function pushAllLocalDataToFirebaseNow(silent = false) {
    if (!db || !firebaseConnected) {
        if (!silent) showToast('Conecte primeiro ao Firebase.', 'error');
        return;
    }
    const ok = await syncLocalToCloud();
    if (ok && !silent) {
        showToast(`Todas as ${tasks.length} tarefas foram gravadas diretamente no Firebase!`, 'success');
    }
}

// Desativado: Não carrega nem salva tarefas no navegador (100% Firebase)
function loadTasksFromLocalCache() {
    // Intencionalmente vazio: tarefas vêm exclusivamente do Firebase Cloud Firestore
}

function saveLocalCacheOnly() {
    // Intencionalmente vazio: tarefas são salvas exclusivamente no Firebase Cloud Firestore
}

/**************************************************************
 * 10. BACKUP JSON (EXPORTAÇÃO & IMPORTAÇÃO DIRETA NO FIREBASE)
 **************************************************************/
function exportTasksJSON() {
    if (!hasUserPermission('canExportImport')) {
        showToast('Você não possui permissão para exportar backups JSON.', 'error');
        return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `taskflow_${currentWorkspace}_backup_${getLocalDateStr(0)}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
    showToast('Backup JSON exportado com sucesso!', 'success');
}

let pendingImportedJsonTasks = null;

function importTasksJSON(e) {
    if (!hasUserPermission('canExportImport')) {
        showToast('Você não possui permissão para importar backups JSON.', 'error');
        e.target.value = '';
        return;
    }
    const file = e.target.files[0];
    if (!file) return;
    const fileName = file.name;
    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            const imported = JSON.parse(evt.target.result);
            if (Array.isArray(imported)) {
                pendingImportedJsonTasks = imported;
                const summaryEl = document.getElementById('jsonImportChoiceModal') ? document.getElementById('jsonImportSummaryText') : null;
                if (summaryEl) {
                    summaryEl.innerHTML = `O arquivo <strong>${escapeHtml(fileName)}</strong> contém <strong>${imported.length} tarefa(s)</strong> (atualmente existem <strong>${tasks.length} tarefa(s)</strong> no Firebase). Deseja acrescentar às atuais ou substituir tudo no Firebase?`;
                }
                document.getElementById('jsonImportChoiceModal').classList.remove('hidden');
            } else {
                showToast('Formato de arquivo inválido.', 'error');
            }
        } catch (err) {
            showToast('Erro ao ler o ficheiro JSON.', 'error');
        }
        e.target.value = '';
    };
    reader.readAsText(file);
}

function closeJsonImportChoiceModal() {
    pendingImportedJsonTasks = null;
    document.getElementById('jsonImportChoiceModal')?.classList.add('hidden');
}

async function executePendingJsonImport(mode) {
    if (!Array.isArray(pendingImportedJsonTasks)) {
        closeJsonImportChoiceModal();
        return;
    }
    const importedList = pendingImportedJsonTasks;
    closeJsonImportChoiceModal();

    if (!db || !firebaseConnected) {
        showToast('Erro: Sem conexão com o Firebase! Não é possível importar sem conexão com o banco.', 'error');
        return;
    }

    const nowTs = Date.now();
    const normalizeImportedTask = (t, idx, finalId) => {
        const cleanAuthor = (t.author || currentAuthor || '').trim();
        const rawSubs = Array.isArray(t.subtasks) ? t.subtasks : [];
        const structuredSubs = ensureSubtaskStructure(rawSubs).map(s => ({
            ...s,
            assignee: s.assignee || cleanAuthor
        }));
        return {
            ...t,
            id: finalId,
            author: cleanAuthor,
            subtasks: structuredSubs,
            updatedAt: nowTs + idx
        };
    };

    if (mode === 'replace') {
        const oldIds = tasks.map(t => t.id);
        tasks = importedList.map((t, idx) => {
            const safeId = getSafeFirestoreDocId(t.id || ('task_imp_' + idx + '_' + nowTs));
            return {
                ...normalizeImportedTask(t, idx, safeId),
                manualOrder: idx
            };
        });
        renderAll();
        try {
            await Promise.all(oldIds.map(oid => db.collection(UNIFIED_TASKS_COLLECTION).doc(getSafeFirestoreDocId(oid)).delete().catch(() => {})));
        } catch (e) {}
        const ok = await syncLocalToCloud();
        if (ok) {
            showToast(`Lista substituída por ${tasks.length} tarefa(s) diretamente no Firebase!`, 'success');
        }
    } else {
        const existingIds = new Set(tasks.map(t => getSafeFirestoreDocId(t.id)));
        let addedCount = 0;

        const preparedToAdd = importedList.map((t, idx) => {
            let finalId = getSafeFirestoreDocId(t.id || ('task_imp_' + idx + '_' + nowTs));
            if (existingIds.has(finalId)) {
                finalId = finalId + '_copia_' + nowTs + '_' + idx;
            }
            existingIds.add(finalId);
            addedCount++;
            return normalizeImportedTask(t, idx, finalId);
        });

        tasks = [...preparedToAdd, ...tasks];
        tasks.forEach((t, i) => { t.manualOrder = i; });
        renderAll();
        const ok = await syncLocalToCloud();
        if (ok) {
            showToast(`${addedCount} tarefa(s) importada(s) e gravada(s) no Firebase (Total: ${tasks.length})!`, 'success');
        }
    }
}
