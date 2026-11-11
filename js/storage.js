// =========================================================================
// 2. js/storage.js — Chave Online (Firebase Cloud Firestore) / Offline (Local)
//    + Pergunta ao Acessar se Deseja Tornar Online
// =========================================================================

let inMemoryRoomsMap = {};
let inMemoryUsersMap = {};
let isOnlineModeEnabled = true; // Controlado pela chave Online/Offline e pelo modal ao acessar

function purgeLegacyBrowserDatabaseCache() {
    if (!isOnlineModeEnabled) return; // Em modo Online puro, não acumula banco antigo no navegador
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
    if (!isOnlineModeEnabled) {
        try {
            const raw = localStorage.getItem(LOCAL_ROOM_CONFIG_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                Object.assign(inMemoryRoomsMap, parsed);
            }
        } catch (e) {}
    }
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
    if (!isOnlineModeEnabled) {
        try {
            localStorage.setItem(LOCAL_ROOM_CONFIG_KEY, JSON.stringify(inMemoryRoomsMap));
        } catch (e) {}
    }
}

function removeLocalRoomConfig(roomName) {
    if (!roomName) return;
    const key = String(roomName).toLowerCase();
    delete inMemoryRoomsMap[key];
    if (!isOnlineModeEnabled) {
        try {
            localStorage.setItem(LOCAL_ROOM_CONFIG_KEY, JSON.stringify(inMemoryRoomsMap));
        } catch (e) {}
    }
}

function getSafeFirestoreDocId(rawId) {
    return String(rawId || '').trim().replace(/[\/#?\[\]]/g, '_');
}

/**************************************************************
 * 5. MOTOR COM CHAVE ONLINE (FIREBASE) E OFFLINE (LOCAL)
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

/**
 * Alterna a chave Online / Offline a qualquer momento pelo botão no cabeçalho
 */
async function toggleOnlineOfflineMode() {
    await setOnlineOfflineMode(!isOnlineModeEnabled, true);
}

/**
 * Define explicitamente o modo Online (true) ou Offline (false)
 */
async function setOnlineOfflineMode(targetOnline, showFeedback = true) {
    isOnlineModeEnabled = Boolean(targetOnline);

    if (isOnlineModeEnabled) {
        const ok = initFirebase();
        if (ok && db) {
            try {
                await db.enableNetwork();
            } catch (e) {}
            setupFirestoreRealtimeListener();
            // Se havia tarefas criadas enquanto estava Offline, sincroniza com o Firebase e limpa cache local
            if (Array.isArray(tasks) && tasks.length > 0) {
                await syncLocalToCloud();
            }
            await fetchTasksViaRestFallback();
            purgeLegacyBrowserDatabaseCache();
            updateCloudStatusUI('synced');
            if (showFeedback) {
                showToast('Chave ONLINE ativada! Conectado em tempo real ao Firebase Cloud.', 'success');
            }
        } else {
            updateCloudStatusUI('error');
            if (showFeedback) {
                showToast('Não foi possível conectar ao Firebase. Verifique a configuração.', 'error');
            }
        }
    } else {
        // Modo OFFLINE ativado pela chave
        if (firestoreTasksUnsubscribe) { firestoreTasksUnsubscribe(); firestoreTasksUnsubscribe = null; }
        if (firestoreUsersUnsubscribe) { firestoreUsersUnsubscribe(); firestoreUsersUnsubscribe = null; }
        if (firestoreRoomsUnsubscribe) { firestoreRoomsUnsubscribe(); firestoreRoomsUnsubscribe = null; }

        if (db && typeof db.disableNetwork === 'function') {
            try {
                await db.disableNetwork();
            } catch (e) {}
        }
        firebaseConnected = false;
        saveLocalCacheOnly();
        updateCloudStatusUI('offline');
        if (showFeedback) {
            showToast('Chave OFFLINE ativada! O sistema está operando desconectado da nuvem.', 'info');
        }
    }
}

function initFirebase() {
    if (!isOnlineModeEnabled) {
        firebaseConnected = false;
        updateCloudStatusUI('offline');
        return false;
    }

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
        purgeLegacyBrowserDatabaseCache();
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
    const track = document.getElementById('onlineOfflineTrack');
    const thumb = document.getElementById('onlineOfflineThumb');
    const adminBadge = document.getElementById('fbAdminConfigStatusBadge');

    if (!badge || !dot || !text) return;

    const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const cfg = getActiveFirebaseConfig();

    if (!isOnlineModeEnabled || state === 'offline' || state === 'local') {
        if (track) track.className = 'relative inline-flex h-4 w-8 shrink-0 items-center rounded-full bg-slate-400 dark:bg-slate-600 transition-colors duration-200';
        if (thumb) thumb.className = 'inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform duration-200 translate-x-0.5';
        badge.className = 'inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400';
        dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500';
        text.textContent = 'OFFLINE';
        badge.title = `Modo OFFLINE ativo (${timeStr}) • Clique na chave para tornar ONLINE no Firebase`;
        if (adminBadge) {
            adminBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30';
            adminBadge.innerHTML = `<i class="fa-solid fa-toggle-off mr-1"></i>Modo Offline`;
        }
        return;
    }

    if (state === 'connecting') {
        if (track) track.className = 'relative inline-flex h-4 w-8 shrink-0 items-center rounded-full bg-amber-500 transition-colors duration-200';
        if (thumb) thumb.className = 'inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform duration-200 translate-x-2';
        badge.className = 'inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400';
        dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping';
        text.textContent = 'CONECTANDO...';
        return;
    }

    if (firebaseConnected && db && state !== 'error') {
        if (track) track.className = 'relative inline-flex h-4 w-8 shrink-0 items-center rounded-full bg-emerald-500 transition-colors duration-200';
        if (thumb) thumb.className = 'inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform duration-200 translate-x-4';
        badge.className = 'inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400';
        dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse';
        text.textContent = 'ONLINE (FIREBASE)';
        badge.title = `Modo ONLINE no Firebase (${cfg?.projectId}) • Última sinc: ${timeStr} • Clique para mudar para Offline`;
        if (adminBadge) {
            adminBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30';
            adminBadge.innerHTML = `<i class="fa-solid fa-cloud-bolt mr-1"></i>Online (${escapeHtml(cfg?.projectId || 'Firebase')})`;
        }
    } else {
        if (track) track.className = 'relative inline-flex h-4 w-8 shrink-0 items-center rounded-full bg-rose-500 transition-colors duration-200';
        if (thumb) thumb.className = 'inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform duration-200 translate-x-0.5';
        badge.className = 'inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400';
        dot.className = 'w-1.5 h-1.5 rounded-full bg-rose-500';
        text.textContent = 'ERRO FIREBASE';
        if (adminBadge) {
            adminBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30';
            adminBadge.textContent = 'Erro Firebase';
        }
    }
}

function setupGlobalUsersAndRoomsRealtimeListeners() {
    if (!isOnlineModeEnabled || !db || !firebaseConnected) return;

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
    if (!isOnlineModeEnabled || !db || !firebaseConnected) {
        updateCloudStatusUI(isOnlineModeEnabled ? 'error' : 'offline');
        return;
    }

    if (firestoreTasksUnsubscribe) {
        firestoreTasksUnsubscribe();
        firestoreTasksUnsubscribe = null;
    }

    firestoreTasksUnsubscribe = db.collection(UNIFIED_TASKS_COLLECTION).onSnapshot(snapshot => {
        if (!isOnlineModeEnabled) return;
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
    if (!isOnlineModeEnabled) {
        loadTasksFromLocalCache();
        renderAll();
        updateCloudStatusUI('offline');
        return true;
    }

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

    if (!isOnlineModeEnabled) {
        saveLocalCacheOnly();
        updateCloudStatusUI('offline');
        return true;
    }

    if (!db || !firebaseConnected) {
        showToast('Erro: Firebase não está conectado! Verifique a chave Online/Offline.', 'error');
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

    if (!isOnlineModeEnabled) {
        saveLocalCacheOnly();
        updateCloudStatusUI('offline');
        return true;
    }

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
    if (!isOnlineModeEnabled) {
        saveLocalCacheOnly();
        updateCloudStatusUI('offline');
        return true;
    }

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

function loadFirebaseConfigIntoModalUI() {
    const inp = document.getElementById('fbConfigJsonInput');
    if (!inp) return;
    const cfg = getActiveFirebaseConfig();
    if (cfg && cfg.apiKey && cfg.projectId) {
        inp.value = JSON.stringify(cfg, null, 2);
    } else {
        inp.value = '';
    }
    updateCloudStatusUI(isOnlineModeEnabled ? (firebaseConnected ? 'synced' : 'error') : 'offline');
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

    await setOnlineOfflineMode(true, true);
}

async function disconnectFirebaseAndUseLocal() {
    await setOnlineOfflineMode(false, true);
}

async function pushAllLocalDataToFirebaseNow(silent = false) {
    if (!isOnlineModeEnabled) {
        await setOnlineOfflineMode(true, false);
    }
    if (!db || !firebaseConnected) {
        if (!silent) showToast('Conecte primeiro ao Firebase.', 'error');
        return;
    }
    const ok = await syncLocalToCloud();
    if (ok && !silent) {
        showToast(`Todas as ${tasks.length} tarefas foram gravadas diretamente no Firebase!`, 'success');
    }
}

// Quando ONLINE: não guarda tarefas no navegador. Quando OFFLINE: guarda temporariamente até ficar Online.
function loadTasksFromLocalCache() {
    if (isOnlineModeEnabled) return;
    try {
        const raw = localStorage.getItem('taskflow_pro_unified_tasks_v8');
        if (raw) tasks = JSON.parse(raw) || [];
    } catch (e) {}
}

function saveLocalCacheOnly() {
    if (isOnlineModeEnabled) return;
    try {
        localStorage.setItem('taskflow_pro_unified_tasks_v8', JSON.stringify(tasks));
    } catch (e) {}
}

/**************************************************************
 * 10. BACKUP JSON (EXPORTAÇÃO & IMPORTAÇÃO)
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
                    summaryEl.innerHTML = `O arquivo <strong>${escapeHtml(fileName)}</strong> contém <strong>${imported.length} tarefa(s)</strong> (atualmente existem <strong>${tasks.length} tarefa(s)</strong>). Confirme abaixo para acrescentá-las às tarefas existentes:`;
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

    if (isOnlineModeEnabled && (!db || !firebaseConnected)) {
        showToast('Erro: Sem conexão com o Firebase! Ative a conexão ou mude a chave para Offline.', 'error');
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

    {
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
            showToast(`${addedCount} tarefa(s) importada(s) (${isOnlineModeEnabled ? 'gravadas no Firebase' : 'modo Offline'} • Total: ${tasks.length})!`, 'success');
        }
    }
}
