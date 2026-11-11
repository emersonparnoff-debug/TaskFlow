// =========================================================================
// 2. js/storage.js — Persistência Híbrida: Google Firebase Cloud Firestore
//    (Sincronização em Tempo Real) + Cache Local (localStorage) e Backup JSON
// =========================================================================

/**************************************************************
 * 3. ROOM CONFIGS & DROPDOWN
 **************************************************************/
function getLocalRoomConfigs() {
    try {
        return JSON.parse(localStorage.getItem(LOCAL_ROOM_CONFIG_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function saveLocalRoomConfig(roomName, configObj) {
    try {
        const map = getLocalRoomConfigs();
        map[roomName] = {
            ...(map[roomName] || {}),
            ...configObj,
            id: roomName,
            roomName: (configObj.roomName || roomName).toUpperCase()
        };
        localStorage.setItem(LOCAL_ROOM_CONFIG_KEY, JSON.stringify(map));
    } catch (e) {}
}

function removeLocalRoomConfig(roomName) {
    try {
        const map = getLocalRoomConfigs();
        delete map[roomName];
        localStorage.setItem(LOCAL_ROOM_CONFIG_KEY, JSON.stringify(map));
    } catch (e) {}
}

/**************************************************************
 * 5. MOTOR FIREBASE CLOUD FIRESTORE + FALLBACK LOCAL
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

/**
 * Aceita tanto JSON puro quanto o trecho JS copiado direto do Console do Firebase
 * (ex: const firebaseConfig = { apiKey: "...", projectId: "..." };)
 */
function parseFlexibleFirebaseConfigInput(rawText) {
    if (!rawText || !String(rawText).trim()) return null;
    let txt = String(rawText).trim();

    // Extrai apenas o bloco { ... } se o usuário colou "const firebaseConfig = { ... };"
    const firstBrace = txt.indexOf('{');
    const lastBrace = txt.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        txt = txt.substring(firstBrace, lastBrace + 1);
    }

    try {
        return JSON.parse(txt);
    } catch (e) {
        // Converte chaves JS sem aspas (ex: apiKey: "...") para JSON válido
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
    const cfg = getActiveFirebaseConfig();
    if (!cfg || !cfg.apiKey || !cfg.projectId) {
        db = null;
        firebaseConnected = false;
        updateCloudStatusUI('local');
        return false;
    }

    if (typeof firebase === 'undefined' || !firebase.firestore) {
        db = null;
        firebaseConnected = false;
        updateCloudStatusUI('offline');
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
        text.textContent = 'Conectando...';
        badge.title = 'Conectando ao Google Firebase Cloud Firestore...';
        return;
    }

    if (firebaseConnected && db && state !== 'error') {
        badge.className = 'hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 shrink-0 cursor-pointer transition';
        dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse';
        text.textContent = `Firebase (${cfg?.projectId || 'Ativo'})`;
        badge.title = `Sincronizado em Tempo Real no Firebase (${cfg?.projectId}) • Última sinc: ${timeStr}`;
        if (adminBadge) {
            adminBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30';
            adminBadge.innerHTML = `<i class="fa-solid fa-cloud-bolt mr-1"></i>Conectado (${escapeHtml(cfg?.projectId || 'Firebase')})`;
        }
    } else if (state === 'error') {
        badge.className = 'hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 shrink-0 cursor-pointer transition';
        dot.className = 'w-1.5 h-1.5 rounded-full bg-rose-500';
        text.textContent = 'Erro Firebase (Local)';
        badge.title = 'Erro ao conectar no Firebase. Operando em cache local. Clique para revisar a configuração.';
        if (adminBadge) {
            adminBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30';
            adminBadge.textContent = 'Erro na Conexão';
        }
    } else {
        badge.className = 'hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0 cursor-pointer transition';
        dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500';
        text.textContent = 'Local (Configurar Nuvem)';
        badge.title = `Armazenamento Local Ativo (${timeStr}) • Clique para configurar o Firebase`;
        if (adminBadge) {
            adminBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-500/15 text-slate-600 dark:text-slate-300 border border-slate-500/30';
            adminBadge.textContent = 'Modo Local (Offline)';
        }
    }
}

function setupGlobalUsersAndRoomsRealtimeListeners() {
    if (!db || !firebaseConnected) return;

    // Listener em tempo real para Contas de Usuários e Permissões
    if (firestoreUsersUnsubscribe) firestoreUsersUnsubscribe();
    firestoreUsersUnsubscribe = db.collection(USERS_CONFIG_COLLECTION).onSnapshot(snapshot => {
        const localMap = getLocalUsersMap();
        snapshot.docChanges().forEach(change => {
            const docData = change.doc.data();
            const docId = change.doc.id;
            if (change.type === 'removed') {
                delete localMap[docId];
            } else if (docData) {
                localMap[docId] = { ...docData, id: docId };
            }
        });
        localStorage.setItem(LOCAL_USERS_CONFIG_KEY, JSON.stringify(localMap));
        if (typeof fetchAllUsersFromCloud === 'function') {
            fetchAllUsersFromCloud();
        }
    }, err => {
        console.warn('Aviso listener de usuários Firestore:', err);
    });

    // Listener em tempo real para Salas criadas
    if (firestoreRoomsUnsubscribe) firestoreRoomsUnsubscribe();
    firestoreRoomsUnsubscribe = db.collection(ROOMS_CONFIG_COLLECTION).onSnapshot(snapshot => {
        const localRooms = getLocalRoomConfigs();
        snapshot.docChanges().forEach(change => {
            const docData = change.doc.data();
            const docId = change.doc.id;
            if (change.type === 'removed') {
                delete localRooms[docId];
            } else if (docData) {
                localRooms[docId] = { ...docData, id: docId };
            }
        });
        localStorage.setItem(LOCAL_ROOM_CONFIG_KEY, JSON.stringify(localRooms));
        if (typeof renderAdminQuickRoomSwitcher === 'function') {
            renderAdminQuickRoomSwitcher();
        }
    }, err => {
        console.warn('Aviso listener de salas Firestore:', err);
    });
}

function setupFirestoreRealtimeListener() {
    if (!db || !firebaseConnected) {
        updateCloudStatusUI('local');
        return;
    }

    if (firestoreTasksUnsubscribe) {
        firestoreTasksUnsubscribe();
        firestoreTasksUnsubscribe = null;
    }

    firestoreTasksUnsubscribe = db.collection(UNIFIED_TASKS_COLLECTION).onSnapshot(snapshot => {
        if (snapshot.metadata.hasPendingWrites) return;

        const cloudTasks = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data && data.id) {
                cloudTasks.push(data);
            }
        });

        // Se o Firebase estiver vazio mas o navegador tiver tarefas locais, envia automaticamente as locais para o Firebase
        if (cloudTasks.length === 0 && tasks.length > 0) {
            syncLocalToCloud();
            return;
        }

        isApplyingRemoteUpdate = true;
        tasks = cloudTasks;
        saveLocalCacheOnly();
        renderAll();
        updateCloudStatusUI('synced');
        isApplyingRemoteUpdate = false;
    }, err => {
        console.error('Erro no listener de tarefas do Firestore:', err);
        updateCloudStatusUI('error');
    });
}

async function fetchTasksViaRestFallback() {
    if (db && firebaseConnected) {
        try {
            const snap = await db.collection(UNIFIED_TASKS_COLLECTION).get();
            if (!snap.empty) {
                const list = [];
                snap.forEach(doc => {
                    const d = doc.data();
                    if (d && d.id) list.push(d);
                });
                tasks = list;
                saveLocalCacheOnly();
            } else if (tasks.length > 0) {
                await syncLocalToCloud();
            }
            renderAll();
            updateCloudStatusUI('synced');
            return true;
        } catch (e) {
            console.warn('Fallback para cache local:', e);
        }
    }
    loadTasksFromLocalCache();
    renderAll();
    updateCloudStatusUI(firebaseConnected ? 'synced' : 'local');
    return true;
}

async function deleteTaskViaRest(taskId) {
    return await removeTaskFromCloud(taskId);
}

async function upsertTaskToCloud(taskObj) {
    if (!taskObj || !taskObj.id) return false;
    taskObj.updatedAt = Date.now();
    saveLocalCacheOnly();

    if (db && firebaseConnected) {
        try {
            const cleanData = JSON.parse(JSON.stringify(taskObj));
            await db.collection(UNIFIED_TASKS_COLLECTION).doc(String(taskObj.id)).set(cleanData, { merge: true });
            updateCloudStatusUI('synced');
            return true;
        } catch (err) {
            console.error('Erro ao salvar tarefa no Firestore:', err);
            updateCloudStatusUI('error');
            return false;
        }
    }
    updateCloudStatusUI('local');
    return true;
}

async function removeTaskFromCloud(taskId) {
    tasks = tasks.filter(t => t.id !== taskId);
    saveLocalCacheOnly();

    if (db && firebaseConnected && taskId) {
        try {
            await db.collection(UNIFIED_TASKS_COLLECTION).doc(String(taskId)).delete();
            updateCloudStatusUI('synced');
            return true;
        } catch (err) {
            console.error('Erro ao remover tarefa do Firestore:', err);
            updateCloudStatusUI('error');
            return false;
        }
    }
    updateCloudStatusUI('local');
    return true;
}

async function syncLocalToCloud() {
    saveLocalCacheOnly();
    if (!db || !firebaseConnected) {
        updateCloudStatusUI('local');
        return true;
    }

    try {
        const batch = db.batch();
        (tasks || []).forEach(t => {
            if (t && t.id) {
                const ref = db.collection(UNIFIED_TASKS_COLLECTION).doc(String(t.id));
                batch.set(ref, JSON.parse(JSON.stringify(t)), { merge: true });
            }
        });
        await batch.commit();
        updateCloudStatusUI('synced');
        return true;
    } catch (err) {
        console.error('Erro ao sincronizar lote com o Firestore:', err);
        updateCloudStatusUI('error');
        return false;
    }
}

// Funções da Interface de Configuração do Firebase no Painel do Administrador
function loadFirebaseConfigIntoModalUI() {
    const inp = document.getElementById('fbConfigJsonInput');
    if (!inp) return;
    const cfg = getActiveFirebaseConfig();
    if (cfg && cfg.apiKey && cfg.projectId) {
        inp.value = JSON.stringify(cfg, null, 2);
    } else {
        inp.value = '';
    }
    updateCloudStatusUI(firebaseConnected ? 'synced' : 'local');
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

    // Caso já exista uma instância do Firebase aberta com outro projeto, recarrega para inicializar limpa
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
        try {
            await Promise.all(firebase.apps.map(app => app.delete()));
        } catch (e) {}
    }

    const ok = initFirebase();
    if (ok) {
        setupFirestoreRealtimeListener();
        await pushAllLocalDataToFirebaseNow(true);
        showToast(`Conectado ao Firebase (${parsed.projectId}) em tempo real!`, 'success');
    } else {
        showToast('Não foi possível conectar ao Firebase. Verifique as credenciais informadas.', 'error');
    }
}

async function disconnectFirebaseAndUseLocal() {
    if (firestoreTasksUnsubscribe) { firestoreTasksUnsubscribe(); firestoreTasksUnsubscribe = null; }
    if (firestoreUsersUnsubscribe) { firestoreUsersUnsubscribe(); firestoreUsersUnsubscribe = null; }
    if (firestoreRoomsUnsubscribe) { firestoreRoomsUnsubscribe(); firestoreRoomsUnsubscribe = null; }

    localStorage.removeItem(FIREBASE_CUSTOM_CONFIG_KEY);
    db = null;
    firebaseConnected = false;
    const inp = document.getElementById('fbConfigJsonInput');
    if (inp) inp.value = '';
    updateCloudStatusUI('local');
    showToast('Desconectado da nuvem. O sistema está operando 100% em armazenamento local.', 'info');
}

async function pushAllLocalDataToFirebaseNow(silent = false) {
    if (!db || !firebaseConnected) {
        if (!silent) showToast('Conecte e salve primeiro as credenciais do Firebase acima.', 'error');
        return;
    }

    try {
        // 1. Envia usuários locais
        const localUsers = getLocalUsersMap();
        for (const uKey of Object.keys(localUsers)) {
            await db.collection(USERS_CONFIG_COLLECTION).doc(uKey).set(JSON.parse(JSON.stringify(localUsers[uKey])), { merge: true });
        }
        // 2. Envia salas locais
        const localRooms = getLocalRoomConfigs();
        for (const rKey of Object.keys(localRooms)) {
            await db.collection(ROOMS_CONFIG_COLLECTION).doc(rKey).set(JSON.parse(JSON.stringify(localRooms[rKey])), { merge: true });
        }
        // 3. Envia todas as tarefas
        await syncLocalToCloud();
        if (!silent) {
            showToast(`Todos os dados locais (${tasks.length} tarefas, contas e salas) foram sincronizados para o Firebase!`, 'success');
        }
    } catch (err) {
        console.error('Erro ao enviar dados locais para o Firebase:', err);
        if (!silent) showToast('Erro ao enviar dados para o Firebase: ' + (err.message || err), 'error');
    }
}

function loadTasksFromLocalCache() {
    try {
        const raw = localStorage.getItem(getStorageKey());
        if (raw) {
            tasks = JSON.parse(raw);
        } else {
            tasks = [];
        }
    } catch (e) {
        tasks = [];
    }
}

function saveLocalCacheOnly() {
    try {
        localStorage.setItem(getStorageKey(), JSON.stringify(tasks));
    } catch (e) {}
}

/**************************************************************
 * 10. BACKUP, THEME & TOASTS
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
    showToast('Backup exportado com sucesso!', 'success');
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
                const summaryEl = document.getElementById('jsonImportSummaryText');
                if (summaryEl) {
                    summaryEl.innerHTML = `O arquivo <strong>${escapeHtml(fileName)}</strong> contém <strong>${imported.length} tarefa(s)</strong> (atualmente existem <strong>${tasks.length} tarefa(s)</strong> no sistema). Deseja acrescentar às atuais ou substituir tudo?`;
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

    if (mode === 'replace') {
        tasks = importedList.map((t, idx) => ({
            ...t,
            id: t.id || ('task_imp_' + idx + '_' + Date.now()),
            subtasks: ensureSubtaskStructure(t.subtasks || []),
            manualOrder: idx
        }));
        saveLocalCacheOnly();
        renderAll();
        await syncLocalToCloud(true);
        showToast(`Lista substituída por ${tasks.length} tarefa(s) do arquivo JSON!`, 'success');
    } else {
        const existingIds = new Set(tasks.map(t => t.id));
        let addedCount = 0;

        const preparedToAdd = importedList.map((t, idx) => {
            let finalId = t.id || ('task_imp_' + idx + '_' + Date.now());
            if (existingIds.has(finalId)) {
                finalId = finalId + '_copia_' + Date.now() + '_' + idx;
            }
            existingIds.add(finalId);
            addedCount++;
            return {
                ...t,
                id: finalId,
                subtasks: ensureSubtaskStructure(t.subtasks || [])
            };
        });

        tasks = [...preparedToAdd, ...tasks];
        tasks.forEach((t, i) => { t.manualOrder = i; });
        saveLocalCacheOnly();
        renderAll();
        await syncLocalToCloud(true);
        showToast(`${addedCount} tarefa(s) acrescentada(s) às existentes (Total: ${tasks.length})!`, 'success');
    }
}
