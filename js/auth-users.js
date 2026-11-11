// =========================================================================
// 3. js/auth-users.js — Autenticação, Cadastro de Contas, Senhas e Permissões
// =========================================================================

/**************************************************************
 * 3.1 USER & ADMIN ACCOUNTS STORAGE (CLOUD + LOCAL)
 **************************************************************/
function getLocalUsersMap() {
    if (typeof isOnlineModeEnabled !== 'undefined' && !isOnlineModeEnabled) {
        try {
            const raw = localStorage.getItem(LOCAL_USERS_CONFIG_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                Object.assign(inMemoryUsersMap, parsed);
            }
        } catch (e) {}
    }
    return typeof inMemoryUsersMap !== 'undefined' ? inMemoryUsersMap : {};
}

function saveLocalUserAccount(usernameKey, userObj) {
    if (!usernameKey || typeof inMemoryUsersMap === 'undefined') return;
    const key = String(usernameKey).toLowerCase();
    inMemoryUsersMap[key] = {
        ...(inMemoryUsersMap[key] || {}),
        ...userObj,
        id: key
    };
    if (typeof isOnlineModeEnabled !== 'undefined' && !isOnlineModeEnabled) {
        try {
            localStorage.setItem(LOCAL_USERS_CONFIG_KEY, JSON.stringify(inMemoryUsersMap));
        } catch (e) {}
    }
}

function removeLocalUserAccount(usernameKey) {
    if (!usernameKey || typeof inMemoryUsersMap === 'undefined') return;
    const key = String(usernameKey).toLowerCase();
    delete inMemoryUsersMap[key];
    if (typeof isOnlineModeEnabled !== 'undefined' && !isOnlineModeEnabled) {
        try {
            localStorage.setItem(LOCAL_USERS_CONFIG_KEY, JSON.stringify(inMemoryUsersMap));
        } catch (e) {}
    }
}

async function fetchAllUsersFromCloud() {
    const usersMap = {};
    if (db && firebaseConnected) {
        try {
            const snap = await db.collection(USERS_CONFIG_COLLECTION).get();
            snap.forEach(doc => {
                const d = doc.data();
                if (d && d.passwordHash) {
                    usersMap[doc.id] = { ...d, id: doc.id };
                    saveLocalUserAccount(doc.id, usersMap[doc.id]);
                }
            });
        } catch (e) {
            console.warn('Fallback leitura de usuários locais:', e);
        }
    }
    const localMap = getLocalUsersMap();
    Object.keys(localMap).forEach(k => {
        if (localMap[k] && localMap[k].passwordHash && !usersMap[k]) {
            usersMap[k] = localMap[k];
        }
    });

    const list = Object.values(usersMap).sort((a, b) =>
        String(a.fullName || a.id).localeCompare(String(b.fullName || b.id), 'pt-BR')
    );
    registeredUsersCache = list;

    const pendingCount = list.filter(u => u.status === 'pending').length;
    const pendingBadge = document.getElementById('pendingUsersBadgeMenu');
    if (pendingBadge) {
        if (pendingCount > 0 && isCurrentUserAdmin) {
            pendingBadge.textContent = pendingCount;
            pendingBadge.classList.remove('hidden');
        } else {
            pendingBadge.classList.add('hidden');
        }
    }

    if (currentUserLogin) {
        const me = list.find(u => String(u.id).toLowerCase() === String(currentUserLogin).toLowerCase());
        if (me) {
            currentUserRole = me.role || currentUserRole;
            currentUserPermissions = normalizePermissions(me.permissions, currentUserRole);
            if (currentUserRole === 'admin') isCurrentUserAdmin = true;
        }
    }

    populateAuthorsDatalist();
    return list;
}

async function saveUserAccountToCloud(usernameKey, userObj) {
    saveLocalUserAccount(usernameKey, userObj);
    if (db && firebaseConnected) {
        try {
            await db.collection(USERS_CONFIG_COLLECTION).doc(String(usernameKey).toLowerCase()).set(JSON.parse(JSON.stringify(userObj)), { merge: true });
        } catch (e) {
            console.warn('Erro ao salvar usuário no Firestore:', e);
        }
    }
    return true;
}

async function deleteUserAccountFromCloud(usernameKey) {
    removeLocalUserAccount(usernameKey);
    if (db && firebaseConnected) {
        try {
            await db.collection(USERS_CONFIG_COLLECTION).doc(String(usernameKey).toLowerCase()).delete();
        } catch (e) {
            console.warn('Erro ao remover usuário no Firestore:', e);
        }
    }
    return true;
}

function getAllTeamMembersList() {
    const namesMap = new Map();
    registeredUsersCache
        .filter(u => u.status !== 'pending')
        .forEach(u => {
            const name = String(u.fullName || u.id).trim();
            if (name) {
                namesMap.set(name.toLowerCase(), {
                    name,
                    subLabel: `@${u.id} (${u.role === 'admin' ? 'Administrador' : 'Membro'})`
                });
            }
        });

    if (currentAuthor && !namesMap.has(currentAuthor.toLowerCase())) {
        namesMap.set(currentAuthor.toLowerCase(), { name: currentAuthor, subLabel: 'Usuário Atual' });
    }

    (tasks || []).forEach(t => {
        if (t.author && !namesMap.has(t.author.trim().toLowerCase())) {
            namesMap.set(t.author.trim().toLowerCase(), { name: t.author.trim(), subLabel: 'Membro Atribuído' });
        }
        (t.subtasks || []).forEach(s => {
            if (s.assignee && !namesMap.has(s.assignee.trim().toLowerCase())) {
                namesMap.set(s.assignee.trim().toLowerCase(), { name: s.assignee.trim(), subLabel: 'Membro Atribuído' });
            }
            (s.innerTasks || []).forEach(it => {
                if (it.assignee && !namesMap.has(it.assignee.trim().toLowerCase())) {
                    namesMap.set(it.assignee.trim().toLowerCase(), { name: it.assignee.trim(), subLabel: 'Membro Atribuído' });
                }
            });
        });
    });

    return Array.from(namesMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function populateAuthorsDatalist() {
    const dl = document.getElementById('registeredUsersDatalist');
    const members = getAllTeamMembersList();
    if (dl) {
        dl.innerHTML = members
            .map(m => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.subLabel)}</option>`)
            .join('');
    }
    const memberFilterEl = document.getElementById('memberFilter');
    if (memberFilterEl) {
        const prev = memberFilterEl.value || 'all';
        memberFilterEl.innerHTML = `<option value="all">👥 Todos da equipe</option>` +
            members.map(m => `<option value="${escapeHtml(m.name.toLowerCase())}">👤 ${escapeHtml(m.name)}</option>`).join('');
        if ([...memberFilterEl.options].some(o => o.value === prev)) {
            memberFilterEl.value = prev;
        }
    }
}

async function loadExistingUsersDropdown(showFeedback = false) {
    const selectEl = document.getElementById('authUserSelect');
    const iconEl = document.getElementById('refreshUsersIcon');
    if (!selectEl) return;

    if (iconEl) iconEl.classList.add('fa-spin');
    const prevVal = selectEl.value || currentUserLogin;

    const users = await fetchAllUsersFromCloud();
    if (iconEl) setTimeout(() => iconEl.classList.remove('fa-spin'), 400);

    if (users.length === 0) {
        selectEl.innerHTML = `<option value="">Nenhuma conta cadastrada — Cadastre-se ao lado</option>`;
    } else {
        selectEl.innerHTML = users.map(u => {
            const login = String(u.id).toLowerCase();
            const name = u.fullName || login;
            const isPending = u.status === 'pending';
            const badge = isPending
                ? '⏳ Aguardando Aprovação do Admin'
                : (u.role === 'admin' ? '👑 ADMIN' : '👤 Membro');
            return `<option value="${escapeHtml(login)}">${escapeHtml(name)} (@${escapeHtml(login)}) — ${badge}</option>`;
        }).join('');

        if (prevVal && users.some(u => String(u.id).toLowerCase() === prevVal.toLowerCase())) {
            selectEl.value = prevVal.toLowerCase();
        } else {
            selectEl.value = String(users[0].id).toLowerCase();
        }
    }

    updateCreateRoomTabVisibilityBySelectedUser();

    if (showFeedback) {
        showToast(`${users.length} conta(s) carregada(s).`, 'info');
    }
}

function handleUserSelectChange() {
    showAuthModalAlert('');
    updateCreateRoomTabVisibilityBySelectedUser();
}

function updateCreateRoomTabVisibilityBySelectedUser() {
    const selectEl = document.getElementById('authUserSelect');
    const createTabBtn = document.getElementById('authTabCreateBtn');
    if (!selectEl || !createTabBtn) return;

    const selectedLogin = (selectEl.value || '').trim().toLowerCase();
    const userObj = registeredUsersCache.find(u => String(u.id).toLowerCase() === selectedLogin);
    const isSelectedAdmin = userObj && userObj.role === 'admin' && userObj.status !== 'pending';

    if (isSelectedAdmin) {
        createTabBtn.classList.remove('opacity-50');
        createTabBtn.title = 'Criar nova sala vazia (Administrador)';
    } else {
        createTabBtn.classList.add('opacity-50');
        createTabBtn.title = 'Apenas contas de Administrador podem criar novas salas';
    }
}

function toggleRegAdminKeyField() {
    const roleSel = document.getElementById('regUserRoleSelect');
    const box = document.getElementById('regAdminSecretContainer');
    const hint = document.getElementById('regAdminKeyHint');
    if (!roleSel || !box || !hint) return;

    box.classList.remove('hidden');
    const existingAdmins = registeredUsersCache.filter(u => u.role === 'admin' && u.status !== 'pending');

    if (existingAdmins.length === 0) {
        hint.innerHTML = `<i class="fa-solid fa-sparkles mr-1"></i><strong>Primeiro Administrador do sistema!</strong> Como ainda não há Administrador cadastrado, a primeira conta será autorizada automaticamente como Administrador.`;
    } else if (roleSel.value === 'admin') {
        hint.innerHTML = `<i class="fa-solid fa-crown mr-1"></i>Para cadastrar um novo <strong>Administrador</strong>, digite a senha de um Administrador ativo (ou deixe em branco para solicitar aprovação de um Admin).`;
    } else {
        hint.innerHTML = `<i class="fa-solid fa-shield-halved mr-1"></i>Digite a senha de um Administrador para <strong>liberar o cadastro imediatamente</strong>, ou deixe em branco para enviar seu cadastro para <strong>aprovação do Administrador</strong>.`;
    }
}

async function fetchAllRoomsFromCloud() {
    const roomsMap = {};
    if (db && firebaseConnected) {
        try {
            const snap = await db.collection(ROOMS_CONFIG_COLLECTION).get();
            snap.forEach(doc => {
                const d = doc.data();
                if (d) {
                    const k = String(doc.id).toLowerCase();
                    roomsMap[k] = { ...d, id: k };
                    saveLocalRoomConfig(k, roomsMap[k]);
                }
            });
        } catch (e) {
            console.warn('Erro ao buscar salas do Firestore:', e);
        }
    }
    const memConfigs = getLocalRoomConfigs();
    Object.keys(memConfigs).forEach(k => {
        const item = memConfigs[k];
        if (item && (item.id || item.roomName) && !roomsMap[k]) {
            roomsMap[k] = item;
        }
    });

    const list = Object.values(roomsMap).sort((a, b) =>
        String(a.roomName || a.id).localeCompare(String(b.roomName || b.id), 'pt-BR')
    );
    availableRoomsCache = list;
    return list;
}

async function loadExistingRoomsDropdown(showFeedback = false) {
    const selectEl = document.getElementById('authRoomSelect');
    const hintEl = document.getElementById('roomsCountHint');
    const iconEl = document.getElementById('refreshRoomsIcon');
    if (!selectEl) return;

    if (iconEl) iconEl.classList.add('fa-spin');
    const previousVal = selectEl.value || currentWorkspace;

    const rooms = await fetchAllRoomsFromCloud();
    if (iconEl) setTimeout(() => iconEl.classList.remove('fa-spin'), 400);

    if (rooms.length === 0) {
        selectEl.innerHTML = `<option value="">Nenhuma sala encontrada — Crie a primeira sala!</option>`;
        if (hintEl) {
            hintEl.innerHTML = `<span class="text-amber-500 font-medium"><i class="fa-solid fa-circle-info mr-1"></i>Ainda não há salas cadastradas. Clique na aba "Nova Sala" acima.</span>`;
        }
    } else {
        selectEl.innerHTML = rooms.map(r => {
            const code = String(r.id).toLowerCase();
            const label = String(r.roomName || r.id).toUpperCase();
            const creator = r.createdBy ? ` • Criada por ${escapeHtml(r.createdBy)}` : '';
            return `<option value="${escapeHtml(code)}">📂 ${escapeHtml(label)}${creator}</option>`;
        }).join('');

        if (previousVal && rooms.some(r => String(r.id).toLowerCase() === previousVal.toLowerCase())) {
            selectEl.value = previousVal.toLowerCase();
        } else {
            selectEl.value = String(rooms[0].id).toLowerCase();
        }

        if (hintEl) {
            hintEl.textContent = `${rooms.length} sala(s) disponível(is). Basta informar sua senha de usuário acima para entrar.`;
        }
    }

    if (showFeedback) {
        showToast(`Lista de salas atualizada (${rooms.length} encontrada${rooms.length === 1 ? '' : 's'}).`, 'info');
    }
}

function handleRoomSelectChange() {
    showAuthModalAlert('');
}

function switchAuthTab(mode) {
    currentAuthMode = mode;
    const joinBtn = document.getElementById('authTabJoinBtn');
    const regUserBtn = document.getElementById('authTabRegisterUserBtn');
    const createBtn = document.getElementById('authTabCreateBtn');

    const credBlock = document.getElementById('authCredentialsBlock');
    const joinSec = document.getElementById('authJoinSection');
    const regUserSec = document.getElementById('authRegisterUserSection');
    const createSec = document.getElementById('authCreateSection');
    const submitText = document.getElementById('authSubmitBtnText');

    showAuthModalAlert('');

    const inactiveClass = 'py-2 px-2 rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';
    joinBtn.className = inactiveClass;
    regUserBtn.className = inactiveClass;
    createBtn.className = inactiveClass;

    joinSec.classList.add('hidden');
    regUserSec.classList.add('hidden');
    createSec.classList.add('hidden');

    if (mode === 'join') {
        joinBtn.className = 'py-2 px-2 rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition bg-white dark:bg-darkCard text-indigo-600 dark:text-indigo-400 shadow-sm';
        credBlock.classList.remove('hidden');
        joinSec.classList.remove('hidden');
        submitText.textContent = 'Entrar na Sala Selecionada';
        loadExistingUsersDropdown(false);
        loadExistingRoomsDropdown(false);
    } else if (mode === 'register_user') {
        regUserBtn.className = 'py-2 px-2 rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition bg-white dark:bg-darkCard text-purple-600 dark:text-purple-400 shadow-sm';
        credBlock.classList.add('hidden');
        regUserSec.classList.remove('hidden');
        submitText.textContent = 'Concluir Cadastro de Conta';
        toggleRegAdminKeyField();
        setTimeout(() => document.getElementById('regFullNameInput')?.focus(), 50);
    } else {
        createBtn.className = 'py-2 px-2 rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition bg-white dark:bg-darkCard text-emerald-600 dark:text-emerald-400 shadow-sm';
        credBlock.classList.remove('hidden');
        createSec.classList.remove('hidden');
        submitText.textContent = 'Criar Sala Vazia (Exclusivo Admin)';
        loadExistingUsersDropdown(false);
        const selectedLogin = (document.getElementById('authUserSelect')?.value || '').trim().toLowerCase();
        const userObj = registeredUsersCache.find(u => String(u.id).toLowerCase() === selectedLogin);
        if (userObj && userObj.role !== 'admin') {
            showAuthModalAlert('Atenção: A conta selecionada é de Membro. Selecione uma conta de Administrador acima para criar uma nova sala.', 'error');
        }
        setTimeout(() => document.getElementById('authNewRoomNameInput')?.focus(), 50);
    }
}

async function fetchRoomConfigFromCloud(roomName) {
    if (db && firebaseConnected) {
        try {
            const doc = await db.collection(ROOMS_CONFIG_COLLECTION).doc(String(roomName).toLowerCase()).get();
            if (doc.exists) {
                const data = doc.data();
                saveLocalRoomConfig(roomName, data);
                return { exists: true, offline: false, data };
            }
        } catch (e) {}
    }
    const map = getLocalRoomConfigs();
    if (map[roomName]) {
        return { exists: true, offline: false, data: map[roomName] };
    }
    return { exists: false, offline: false };
}

async function saveRoomConfigToCloud(roomName, configObj) {
    saveLocalRoomConfig(roomName, configObj);
    if (db && firebaseConnected) {
        try {
            await db.collection(ROOMS_CONFIG_COLLECTION).doc(String(roomName).toLowerCase()).set(JSON.parse(JSON.stringify(configObj)), { merge: true });
        } catch (e) {
            console.warn('Erro ao salvar sala no Firestore:', e);
        }
    }
    return true;
}

async function deleteRoomConfigFromCloud(roomName) {
    removeLocalRoomConfig(roomName);
    if (db && firebaseConnected) {
        try {
            await db.collection(ROOMS_CONFIG_COLLECTION).doc(String(roomName).toLowerCase()).delete();
        } catch (e) {
            console.warn('Erro ao remover sala no Firestore:', e);
        }
    }
    return true;
}

function showAuthModalAlert(msg, type = 'error') {
    const box = document.getElementById('authModalAlert');
    if (!box) return;
    if (!msg) {
        box.classList.add('hidden');
        return;
    }
    box.classList.remove('hidden');
    if (type === 'error') {
        box.className = 'p-3 rounded-xl text-xs font-medium border bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25';
        box.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1.5"></i>${escapeHtml(msg)}`;
    } else if (type === 'success') {
        box.className = 'p-3 rounded-xl text-xs font-medium border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25';
        box.innerHTML = `<i class="fa-solid fa-circle-check mr-1.5"></i>${escapeHtml(msg)}`;
    } else {
        box.className = 'p-3 rounded-xl text-xs font-medium border bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/25';
        box.innerHTML = `<i class="fa-solid fa-circle-info mr-1.5"></i>${escapeHtml(msg)}`;
    }
}

function togglePasswordVisibility(inputId, iconId) {
    const inp = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (!inp || !icon) return;
    if (inp.type === 'password') {
        inp.type = 'text';
        icon.className = 'fa-regular fa-eye-slash text-xs';
    } else {
        inp.type = 'password';
        icon.className = 'fa-regular fa-eye text-xs';
    }
}

async function openRoomAuthModal(allowClose = false) {
    const modal = document.getElementById('roomAuthModal');
    const closeBtn = document.getElementById('closeAuthModalBtn');
    showAuthModalAlert('');

    if (allowClose && isAuthenticated) {
        closeBtn.classList.remove('hidden');
    } else {
        closeBtn.classList.add('hidden');
    }

    const passInput = document.getElementById('authUserPassInput');
    if (passInput) passInput.value = '';
    const roomNameInput = document.getElementById('authNewRoomNameInput');
    if (roomNameInput) roomNameInput.value = '';

    modal.classList.remove('hidden');
    await Promise.all([
        loadExistingUsersDropdown(false),
        loadExistingRoomsDropdown(false)
    ]);

    if (registeredUsersCache.length === 0) {
        switchAuthTab('register_user');
    } else if (availableRoomsCache.length === 0) {
        switchAuthTab('create');
    } else {
        switchAuthTab('join');
    }
}

function closeRoomAuthModal() {
    if (!isAuthenticated) return;
    document.getElementById('roomAuthModal').classList.add('hidden');
}

function updateHeaderSessionUI() {
    const displayUser = currentAuthor || 'Usuário';
    const initials = displayUser
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toUpperCase())
        .join('') || 'U';

    document.getElementById('headerUserAvatar').textContent = initials;
    document.getElementById('headerUserName').textContent = displayUser;
    document.getElementById('menuUserFull').textContent = displayUser;
    const loginSub = document.getElementById('menuUserLoginSub');
    if (loginSub) {
        loginSub.textContent = currentUserLogin ? `@${currentUserLogin} • ${currentUserRole === 'admin' ? 'Administrador Geral' : 'Usuário Cadastrado'}` : '@convidado';
    }
    document.getElementById('headerRoomBadge').textContent = (currentWorkspace || 'SALA').toUpperCase();
    document.getElementById('menuRoomName').textContent = (currentWorkspace || 'SALA').toUpperCase();

    const adminBadge = document.getElementById('headerAdminBadge');
    const adminIcon = document.getElementById('headerAdminIcon');
    const adminText = document.getElementById('headerAdminText');
    const menuPill = document.getElementById('menuRolePill');
    const menuUserDirBtn = document.getElementById('menuUserDirBtn');
    const menuAdminPanelBtn = document.getElementById('menuAdminPanelBtn');

    if (isCurrentUserAdmin) {
        if (adminBadge) {
            adminBadge.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30';
            adminBadge.onclick = null;
        }
        if (adminIcon) adminIcon.className = 'fa-solid fa-crown text-[9px] text-amber-500';
        if (adminText) adminText.textContent = 'Admin';
        if (menuPill) {
            menuPill.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30';
            menuPill.textContent = 'ADMIN';
        }
        if (menuUserDirBtn) menuUserDirBtn.classList.remove('hidden');
        if (menuAdminPanelBtn) menuAdminPanelBtn.classList.remove('hidden');
    } else {
        if (adminBadge) {
            adminBadge.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300';
            adminBadge.onclick = null;
        }
        if (adminIcon) adminIcon.className = 'fa-solid fa-user text-[9px] text-slate-400';
        if (adminText) adminText.textContent = 'Membro';
        if (menuPill) {
            menuPill.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-100 dark:bg-slate-800 text-slate-500';
            menuPill.textContent = 'MEMBRO';
        }
        if (menuUserDirBtn) menuUserDirBtn.classList.add('hidden');
        if (menuAdminPanelBtn) menuAdminPanelBtn.classList.add('hidden');
    }

    // Update New Task button state based on canCreate permission
    const newTaskBtn = document.getElementById('newTaskHeaderBtn');
    if (newTaskBtn) {
        if (hasUserPermission('canCreate')) {
            newTaskBtn.className = 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium text-sm px-4 py-2 rounded-xl shadow-md shadow-indigo-600/20 flex items-center gap-2 transition';
            newTaskBtn.title = 'Criar nova tarefa';
        } else {
            newTaskBtn.className = 'bg-slate-300 dark:bg-slate-800 text-slate-500 dark:text-slate-500 font-medium text-sm px-4 py-2 rounded-xl flex items-center gap-2 cursor-not-allowed opacity-75';
            newTaskBtn.title = 'Você não possui permissão para criar tarefas';
        }
    }
}

async function authenticateSelectedUserAccount() {
    const selectedLogin = (document.getElementById('authUserSelect').value || '').trim().toLowerCase();
    const rawUserPass = document.getElementById('authUserPassInput').value;

    if (!selectedLogin) {
        showAuthModalAlert('Selecione seu usuário cadastrado ou clique na aba "Cadastrar Conta" para criar um.', 'error');
        return null;
    }
    if (!rawUserPass) {
        showAuthModalAlert('Digite sua Senha Pessoal do usuário selecionado.', 'error');
        return null;
    }

    await fetchAllUsersFromCloud();
    const userRecord = registeredUsersCache.find(u => String(u.id).toLowerCase() === selectedLogin);
    if (!userRecord) {
        showAuthModalAlert(`O usuário "@${selectedLogin}" não foi encontrado.`, 'error');
        return null;
    }

    const candidateHash = await computeSha256Hex(`user::${selectedLogin}::${rawUserPass}`);
    if (candidateHash !== userRecord.passwordHash) {
        showAuthModalAlert(`Senha pessoal incorreta para o usuário "${userRecord.fullName || selectedLogin}".`, 'error');
        return null;
    }

    if (userRecord.status === 'pending') {
        showAuthModalAlert(`O cadastro de "${userRecord.fullName || selectedLogin}" ainda está AGUARDANDO AUTORIZAÇÃO de um Administrador. Peça ao Administrador para aprovar sua conta no menu "Cadastro & Permissões".`, 'error');
        return null;
    }

    if (!userRecord.recoveryToken && rawUserPass) {
        userRecord.recoveryToken = btoa(unescape(encodeURIComponent(rawUserPass)));
        await saveUserAccountToCloud(selectedLogin, userRecord);
    }
    return userRecord;
}

async function handleRoomAuthSubmit(event) {
    if (event && event.preventDefault) event.preventDefault();

    const remember = document.getElementById('authRememberToggle').checked;
    const submitBtn = document.getElementById('authSubmitBtn');

    // ================= MODE: REGISTER NEW USER / ADMIN ACCOUNT =================
    if (currentAuthMode === 'register_user') {
        const fullName = document.getElementById('regFullNameInput').value.trim();
        const rawLogin = document.getElementById('regUsernameInput').value.trim().toLowerCase();
        const cleanLogin = rawLogin.replace(/[^a-z0-9._-]/gi, '');
        const rawPass = document.getElementById('regUserPassInput').value;
        const rawWhatsapp = (document.getElementById('regWhatsappInput')?.value || '').trim();
        const cleanWhatsappDigits = rawWhatsapp.replace(/\D/g, '');
        const role = document.getElementById('regUserRoleSelect').value === 'admin' ? 'admin' : 'member';
        const adminMasterKey = document.getElementById('regAdminMasterKeyInput').value;

        if (!fullName || !cleanLogin) {
            showAuthModalAlert('Preencha o Nome Completo e o Login de Acesso.', 'error');
            return;
        }
        if (!cleanWhatsappDigits || cleanWhatsappDigits.length < 10) {
            showAuthModalAlert('Informe um número de WhatsApp válido com DDD (ex: 11 99999-9999) para recuperação de senha.', 'error');
            return;
        }
        if (!rawPass || rawPass.length < 3) {
            showAuthModalAlert('Crie uma Senha Pessoal com pelo menos 3 caracteres.', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Processando cadastro na nuvem...</span>`;
        showAuthModalAlert('');

        try {
            await fetchAllUsersFromCloud();
            const existingUser = registeredUsersCache.find(u => String(u.id).toLowerCase() === cleanLogin);
            if (existingUser) {
                showAuthModalAlert(`O login "@${cleanLogin}" já está cadastrado! Escolha outro login ou use a aba "Entrar".`, 'error');
                return;
            }

            const existingAdmins = registeredUsersCache.filter(u => u.role === 'admin' && u.status !== 'pending');
            let accountStatus = 'pending';
            let finalRole = role;

            if (existingAdmins.length === 0) {
                // First account in the system becomes active Admin automatically so the system isn't locked
                accountStatus = 'active';
                finalRole = 'admin';
            } else if (adminMasterKey) {
                let authorizedByExistingAdmin = false;
                for (const adm of existingAdmins) {
                    const testHash = await computeSha256Hex(`user::${adm.id}::${adminMasterKey}`);
                    if (testHash === adm.passwordHash) {
                        authorizedByExistingAdmin = true;
                        break;
                    }
                }
                if (!authorizedByExistingAdmin) {
                    showAuthModalAlert('Senha de Administrador incorreta! Digite a senha correta de um Administrador para liberar na hora ou deixe o campo em branco para enviar solicitação de aprovação.', 'error');
                    return;
                }
                accountStatus = 'active';
            } else {
                accountStatus = 'pending';
            }

            const userPassHash = await computeSha256Hex(`user::${cleanLogin}::${rawPass}`);
            const newUserObj = {
                id: cleanLogin,
                fullName,
                whatsapp: rawWhatsapp,
                recoveryToken: btoa(unescape(encodeURIComponent(rawPass))),
                role: finalRole,
                status: accountStatus,
                permissions: normalizePermissions(DEFAULT_MEMBER_PERMISSIONS, finalRole),
                passwordHash: userPassHash,
                createdAt: Date.now()
            };

            await saveUserAccountToCloud(cleanLogin, newUserObj);
            await loadExistingUsersDropdown(false);

            // Pre-fill login credentials automatically
            document.getElementById('authUserSelect').value = cleanLogin;
            document.getElementById('authUserPassInput').value = rawPass;

            // Clear registration fields
            document.getElementById('regFullNameInput').value = '';
            document.getElementById('regUsernameInput').value = '';
            document.getElementById('regUserPassInput').value = '';
            const wInp = document.getElementById('regWhatsappInput');
            if (wInp) wInp.value = '';
            document.getElementById('regAdminMasterKeyInput').value = '';

            if (accountStatus === 'pending') {
                switchAuthTab('join');
                showAuthModalAlert(
                    `Solicitação de cadastro para "${fullName}" (@${cleanLogin}) enviada! Um Administrador precisa autorizar sua conta no painel "Cadastro & Permissões" antes do seu primeiro acesso.`,
                    'info'
                );
            } else {
                if (availableRoomsCache.length === 0 && finalRole === 'admin') {
                    switchAuthTab('create');
                } else {
                    switchAuthTab('join');
                }
                showAuthModalAlert(
                    `Conta "${fullName}" (@${cleanLogin}) autorizada e ativada como ${finalRole === 'admin' ? 'ADMINISTRADOR' : 'MEMBRO'}! Agora basta entrar na sala desejada.`,
                    'success'
                );
            }
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i><span id="authSubmitBtnText">${currentAuthMode === 'create' ? 'Criar Sala Vazia (Exclusivo Admin)' : 'Entrar na Sala Selecionada'}</span>`;
        }
        return;
    }

    // ================= MODE: JOIN EXISTING ROOM (MEMBERS & ADMINS) =================
    if (currentAuthMode === 'join') {
        const selectedRoom = (document.getElementById('authRoomSelect').value || '').trim().toLowerCase();

        if (!selectedRoom) {
            showAuthModalAlert('Selecione uma sala já criada na lista suspensa.', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Validando acesso à sala...</span>`;
        showAuthModalAlert('');

        try {
            const verifiedUser = await authenticateSelectedUserAccount();
            if (!verifiedUser) return;

            const cleanRoom = selectedRoom.replace(/[^a-z0-9_-]/gi, '').toLowerCase();
            const cloudCheck = await fetchRoomConfigFromCloud(cleanRoom);
            if (!cloudCheck.exists && !cloudCheck.offline) {
                const existsLocally = availableRoomsCache.some(r => String(r.id).toLowerCase() === cleanRoom);
                if (!existsLocally) {
                    showAuthModalAlert(`A sala "${cleanRoom.toUpperCase()}" não foi encontrada.`, 'error');
                    return;
                }
            }

            currentAuthor = verifiedUser.fullName || verifiedUser.id;
            currentUserLogin = verifiedUser.id;
            currentUserRole = verifiedUser.role || 'member';
            currentUserPermissions = normalizePermissions(verifiedUser.permissions, currentUserRole);
            currentWorkspace = cleanRoom;
            currentRoomPasswordHash = 'open';
            currentRoomAdminHash = 'open';
            isCurrentUserAdmin = currentUserRole === 'admin';
            isAuthenticated = true;

            finalizeLoginSession(remember);
            showToast(`Bem-vindo(a), ${currentAuthor}! Você entrou na sala "${cleanRoom.toUpperCase()}".`, 'success');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i><span id="authSubmitBtnText">Entrar na Sala Selecionada</span>`;
        }
        return;
    }

    // ================= MODE: CREATE NEW ROOM (ADMIN ONLY) =================
    if (currentAuthMode === 'create') {
        const rawRoomName = (document.getElementById('authNewRoomNameInput').value || '').trim();
        const cleanRoom = rawRoomName.replace(/[^a-z0-9_-]/gi, '').toLowerCase();

        if (!cleanRoom) {
            showAuthModalAlert('Digite o nome/código da nova sala que deseja criar.', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Criando nova sala vazia...</span>`;
        showAuthModalAlert('');

        try {
            const verifiedUser = await authenticateSelectedUserAccount();
            if (!verifiedUser) return;

            if (verifiedUser.role !== 'admin') {
                showAuthModalAlert('Acesso negado: Apenas usuários com perfil de ADMINISTRADOR podem criar novas salas. Membros devem usar a aba "Entrar" para acessar salas já criadas.', 'error');
                return;
            }

            const cloudCheck = await fetchRoomConfigFromCloud(cleanRoom);
            if (cloudCheck.exists && cloudCheck.data) {
                showAuthModalAlert(`A sala "${cleanRoom.toUpperCase()}" já existe! Use a aba "Entrar" para acessá-la.`, 'error');
                return;
            }

            const newRoomConfig = {
                id: cleanRoom,
                roomName: cleanRoom.toUpperCase(),
                createdBy: verifiedUser.fullName || verifiedUser.id,
                createdAt: Date.now()
            };

            await saveRoomConfigToCloud(cleanRoom, newRoomConfig);

            currentAuthor = verifiedUser.fullName || verifiedUser.id;
            currentUserLogin = verifiedUser.id;
            currentUserRole = verifiedUser.role || 'member';
            currentUserPermissions = normalizePermissions(verifiedUser.permissions, currentUserRole);
            currentWorkspace = cleanRoom;
            currentRoomPasswordHash = 'open';
            currentRoomAdminHash = 'open';
            isCurrentUserAdmin = currentUserRole === 'admin';
            isAuthenticated = true;

            tasks = [];
            saveLocalCacheOnly();

            finalizeLoginSession(remember);
            showToast(`Sala "${cleanRoom.toUpperCase()}" criada vazia! Conectado como ${currentAuthor}.`, 'success');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i><span id="authSubmitBtnText">Criar Sala Vazia (Exclusivo Admin)</span>`;
        }
    }
}

function finalizeLoginSession(remember) {
    localStorage.setItem(AUTHOR_KEY, currentAuthor);
    if (remember) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
            user: currentAuthor,
            userLogin: currentUserLogin,
            userRole: currentUserRole,
            userPermissions: currentUserPermissions,
            room: currentWorkspace,
            passHash: currentRoomPasswordHash,
            adminHash: currentRoomAdminHash,
            isAdmin: isCurrentUserAdmin,
            timestamp: Date.now()
        }));
    } else {
        localStorage.removeItem(SESSION_KEY);
    }

    updateHeaderSessionUI();
    document.getElementById('roomAuthModal').classList.add('hidden');

    loadTasksFromLocalCache();
    renderAll();
    setupFirestoreRealtimeListener();
    fetchTasksViaRestFallback(true);
}

function logoutSession() {
    isAuthenticated = false;
    isCurrentUserAdmin = false;
    localStorage.removeItem(SESSION_KEY);
    tasks = [];
    renderAll();
    openRoomAuthModal(false);
    showToast('Sessão encerrada. Selecione uma sala para entrar.', 'info');
}

/**************************************************************
 * 4. ADMINISTRATOR PANEL
 **************************************************************/
function openAdminPanelModal() {
    if (!isAuthenticated) {
        openRoomAuthModal(false);
        return;
    }
    if (!isCurrentUserAdmin) {
        showToast('Acesso restrito: Apenas Administradores podem acessar o Painel do Administrador.', 'error');
        return;
    }
    document.getElementById('adminModalRoomLabel').textContent = currentWorkspace.toUpperCase();
    renderAdminBannerState();
    if (typeof loadFirebaseConfigIntoModalUI === 'function') {
        loadFirebaseConfigIntoModalUI();
    }
    document.getElementById('adminPanelModal').classList.remove('hidden');
}

function closeAdminPanelModal() {
    document.getElementById('adminPanelModal').classList.add('hidden');
}

function renderAdminBannerState() {
    const banner = document.getElementById('adminStatusBanner');
    if (!banner) return;
    if (isCurrentUserAdmin) {
        banner.className = 'p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300';
        banner.innerHTML = `
            <div class="flex items-center gap-2">
                <i class="fa-solid fa-crown text-amber-500 text-base"></i>
                <div>
                    <p class="font-bold">Conta Administradora Ativa (${escapeHtml(currentAuthor)})</p>
                    <p class="text-[11px] opacity-90">Você tem permissão total para gerenciar permissões de membros, limpar ou excluir a sala.</p>
                </div>
            </div>
        `;
    } else {
        banner.className = 'p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300';
        banner.innerHTML = `
            <div class="flex items-center gap-2">
                <i class="fa-solid fa-user text-slate-400 text-base"></i>
                <div>
                    <p class="font-bold">Conectado como Membro (${escapeHtml(currentAuthor)})</p>
                    <p class="text-[11px] opacity-90">Apenas contas cadastradas com perfil de Administrador podem limpar ou excluir salas.</p>
                </div>
            </div>
        `;
    }
}

async function adminClearRoomTasks() {
    if (!isCurrentUserAdmin) {
        showToast('Apenas usuários com conta de Administrador podem limpar todas as tarefas da sala.', 'error');
        return;
    }
    closeAdminPanelModal();
    openClearConfirmModal();
}

async function adminDeleteEntireRoom() {
    if (!isCurrentUserAdmin) {
        showToast('Apenas usuários com conta de Administrador podem excluir a sala.', 'error');
        return;
    }

    const roomToDelete = currentWorkspace;
    const idsToRemove = tasks.map(t => t.id);

    tasks = [];
    localStorage.removeItem(getStorageKey());
    try {
        await Promise.all(idsToRemove.map(id => deleteTaskViaRest(id)));
    } catch (e) {}

    await deleteRoomConfigFromCloud(roomToDelete);
    closeAdminPanelModal();
    logoutSession();
    showToast(`A sala "${roomToDelete.toUpperCase()}" foi excluída permanentemente.`, 'info');
}

/**************************************************************
 * 4.1 USER & ADMINISTRATOR DIRECTORY + PERMISSIONS ENGINE
 **************************************************************/
function handleDirRolePresetChange() {
    const roleVal = document.getElementById('dirRoleSelect')?.value || 'member';
    const permsBox = document.getElementById('dirNewUserPermsBox');
    const presetSel = document.getElementById('dirPermPresetSelect');
    if (roleVal === 'admin') {
        if (presetSel) {
            presetSel.value = 'full';
            presetSel.disabled = true;
        }
        applyDirFormPermPreset('full');
        if (permsBox) permsBox.classList.add('opacity-60');
    } else {
        if (presetSel) presetSel.disabled = false;
        if (permsBox) permsBox.classList.remove('opacity-60');
    }
}

function applyDirFormPermPreset(presetKey) {
    const preset = PERMISSION_PRESETS[presetKey] || PERMISSION_PRESETS.full;
    const cCreate = document.getElementById('dirPermCreate');
    const cEdit = document.getElementById('dirPermEdit');
    const cStatus = document.getElementById('dirPermStatus');
    const cDelete = document.getElementById('dirPermDelete');
    const cBackup = document.getElementById('dirPermBackup');

    if (cCreate) cCreate.checked = preset.canCreate;
    if (cEdit) cEdit.checked = preset.canEdit;
    if (cStatus) cStatus.checked = preset.canChangeStatus;
    if (cDelete) cDelete.checked = preset.canDelete;
    if (cBackup) cBackup.checked = preset.canExportImport;
}

function renderMyActivePermsBanner() {
    const banner = document.getElementById('myActivePermsBanner');
    if (!banner) return;
    const perms = normalizePermissions(currentUserPermissions, isCurrentUserAdmin ? 'admin' : currentUserRole);

    const items = [
        { key: 'canCreate', label: 'Criar Tarefas', icon: 'fa-plus' },
        { key: 'canEdit', label: 'Editar Tarefas', icon: 'fa-pen' },
        { key: 'canChangeStatus', label: 'Mover Status & Subtarefas', icon: 'fa-arrows-left-right' },
        { key: 'canDelete', label: 'Excluir Tarefas', icon: 'fa-trash' },
        { key: 'canExportImport', label: 'Backup JSON', icon: 'fa-file-export' }
    ];

    banner.innerHTML = `
        <div class="flex items-center gap-2">
            <i class="fa-solid fa-id-card-clip text-indigo-500 text-sm"></i>
            <span class="font-bold text-slate-700 dark:text-slate-200">Suas Permissões Ativas (${escapeHtml(currentAuthor || 'Convidado')}):</span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
            ${items.map(it => {
                const allowed = isCurrentUserAdmin || perms[it.key];
                return `
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${allowed ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' : 'bg-rose-500/10 text-rose-500 border-rose-500/20 opacity-75'}">
                        <i class="fa-solid ${allowed ? 'fa-check' : 'fa-lock'} text-[9px]"></i> ${it.label}
                    </span>
                `;
            }).join('')}
        </div>
    `;
}

async function openUserDirectoryModal() {
    if (!isAuthenticated) {
        openRoomAuthModal(false);
        return;
    }
    if (!isCurrentUserAdmin) {
        showToast('Acesso restrito: O ambiente de permissões é exclusivo para Administradores.', 'error');
        return;
    }
    document.getElementById('userDirectoryModal').classList.remove('hidden');
    renderMyActivePermsBanner();
    await refreshUserDirectoryList();
}

function closeUserDirectoryModal() {
    document.getElementById('userDirectoryModal').classList.add('hidden');
}

async function refreshUserDirectoryList() {
    const container = document.getElementById('dirUsersTableContainer');
    const countEl = document.getElementById('dirUsersCount');
    if (!container) return;

    container.innerHTML = `<div class="p-6 text-center text-xs text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Carregando contas e matriz de permissões...</div>`;
    const users = await fetchAllUsersFromCloud();
    renderMyActivePermsBanner();
    updateHeaderSessionUI();
    renderAll();

    if (countEl) countEl.textContent = users.length;

    if (users.length === 0) {
        container.innerHTML = `<div class="p-6 text-center text-xs text-slate-400">Nenhuma conta cadastrada ainda. Use o formulário acima para criar o primeiro usuário ou administrador.</div>`;
        return;
    }

    const permBadgesDef = [
        { key: 'canCreate', label: 'Criar', icon: 'fa-plus', desc: 'Criar novas tarefas' },
        { key: 'canEdit', label: 'Editar', icon: 'fa-pen', desc: 'Editar título, prazo, prioridade e subtarefas' },
        { key: 'canChangeStatus', label: 'Status / Kanban', icon: 'fa-table-columns', desc: 'Mover cartões no Kanban e alterar status' },
        { key: 'canManageSubtasks', label: 'Checklist', icon: 'fa-square-check', desc: 'Marcar ou desmarcar subtarefas nos cartões' },
        { key: 'canDelete', label: 'Excluir', icon: 'fa-trash', desc: 'Apagar tarefas da sala' },
        { key: 'canExportImport', label: 'Backup JSON', icon: 'fa-download', desc: 'Exportar e importar arquivos de backup JSON' }
    ];

    container.innerHTML = users.map(u => {
        const login = String(u.id).toLowerCase();
        const isAdm = u.role === 'admin';
        const isPending = u.status === 'pending';
        const isSelf = login === String(currentUserLogin).toLowerCase();
        const perms = normalizePermissions(u.permissions, u.role);
        const initials = String(u.fullName || login)
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map(p => p[0].toUpperCase())
            .join('') || 'U';

        return `
            <div class="p-4 flex flex-col gap-3 ${isPending ? 'bg-amber-500/5 border-l-4 border-l-amber-500' : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'} transition">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full ${isPending ? 'bg-amber-500/20 text-amber-500 border border-amber-500/40' : (isAdm ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' : 'bg-indigo-500/15 text-indigo-500 border border-indigo-500/20')} flex items-center justify-center text-xs font-bold">
                            ${escapeHtml(initials)}
                        </div>
                        <div>
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="text-sm font-bold text-slate-800 dark:text-slate-100">${escapeHtml(u.fullName || login)}</span>
                                ${isSelf ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 font-semibold">Você</span>` : ''}
                                ${isPending ? `
                                    <span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500 text-white animate-pulse">
                                        <i class="fa-solid fa-clock mr-1"></i>AGUARDANDO AUTORIZAÇÃO DO ADMIN
                                    </span>
                                ` : `
                                    <span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                                        <i class="fa-solid fa-circle-check mr-1"></i>Autorizado
                                    </span>
                                `}
                                <span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${isAdm ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}">
                                    ${isAdm ? '<i class="fa-solid fa-crown mr-1"></i>ADMINISTRADOR' : '<i class="fa-solid fa-user mr-1"></i>MEMBRO'}
                                </span>
                            </div>
                            <div class="flex flex-wrap items-center gap-2 mt-1">
                                <p class="text-xs text-slate-400 font-mono">@${escapeHtml(login)}</p>
                                <span class="text-slate-300 dark:text-slate-700">•</span>
                                <div class="inline-flex items-center gap-1 text-xs">
                                    <i class="fa-brands fa-whatsapp text-emerald-500"></i>
                                    ${isCurrentUserAdmin ? `
                                        <input type="tel" value="${escapeHtml(u.whatsapp || '')}" onchange="updateUserWhatsappInDirectory('${escapeHtml(login)}', this.value)" placeholder="Adicionar WhatsApp (DDD)..." class="w-36 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-emerald-500" title="Número de WhatsApp para envio/recuperação de senha">
                                    ` : `
                                        <span class="text-[11px] text-slate-500">${escapeHtml(u.whatsapp || 'Sem WhatsApp')}</span>
                                    `}
                                    ${u.whatsapp ? `
                                        <button type="button" onclick="sendUserPasswordViaWhatsApp('${escapeHtml(login)}')" class="px-2 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 text-[10px] font-bold transition flex items-center gap-1" title="Enviar senha de acesso para o WhatsApp deste usuário">
                                            <i class="fa-solid fa-paper-plane text-[9px]"></i> Enviar Senha
                                        </button>
                                    ` : ''}
                                </div>
                                ${isCurrentUserAdmin ? `
                                    <span class="text-slate-300 dark:text-slate-700">•</span>
                                    <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[11px]">
                                        <i class="fa-solid fa-key text-amber-500 text-[10px]"></i>
                                        <span class="text-slate-500 dark:text-slate-400 font-semibold">Senha:</span>
                                        <input type="text" value="${escapeHtml(getDecodedUserPassword(u))}" onchange="adminSetUserPasswordInDirectory('${escapeHtml(login)}', this.value)" placeholder="Definir nova senha..." class="w-28 px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-amber-500/30 font-mono font-bold text-amber-700 dark:text-amber-300 text-[11px] focus:outline-none focus:border-amber-500" title="Senha visível para o Administrador (edite aqui para alterar a senha deste membro)">
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                        ${isCurrentUserAdmin && isPending ? `
                            <button type="button" onclick="approvePendingUser('${escapeHtml(login)}')" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition flex items-center gap-1.5">
                                <i class="fa-solid fa-user-check"></i> Autorizar Cadastro
                            </button>
                            <button type="button" onclick="deleteDirectoryUser('${escapeHtml(login)}')" class="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 hover:bg-rose-600 text-rose-600 hover:text-white border border-rose-500/30 transition flex items-center gap-1">
                                <i class="fa-solid fa-user-xmark"></i> Recusar
                            </button>
                        ` : ''}

                        ${isCurrentUserAdmin && !isAdm ? `
                            <select onchange="applyMemberPermissionPreset('${escapeHtml(login)}', this.value)" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none">
                                <option value="">⚡ Aplicar Perfil Rápido...</option>
                                <option value="full">⚡ Editor Completo (Tudo)</option>
                                <option value="collaborator">🛠️ Colaborador (Sem Excluir)</option>
                                <option value="status_only">☑️ Apenas Mover Status/Checklist</option>
                                <option value="viewer">👁️ Somente Leitura (Visualizador)</option>
                            </select>
                        ` : ''}

                        ${isCurrentUserAdmin ? `
                            <button type="button" onclick="toggleDirectoryUserRole('${escapeHtml(login)}')" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${isAdm ? 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800' : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'} transition" title="Alternar entre Usuário Membro e Administrador">
                                <i class="fa-solid fa-user-gear mr-1"></i>${isAdm ? 'Tornar Membro' : 'Tornar Admin'}
                            </button>
                            ${!isSelf && !isPending ? `
                                <button type="button" onclick="deleteDirectoryUser('${escapeHtml(login)}')" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition" title="Remover cadastro">
                                    <i class="fa-solid fa-trash-can text-xs"></i>
                                </button>
                            ` : ''}
                        ` : `
                            <span class="text-[11px] text-slate-400 italic"><i class="fa-solid fa-lock mr-1"></i>Apenas Admin altera permissões</span>
                        `}
                    </div>
                </div>

                <!-- Granular Permissions Pills Row -->
                <div class="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-2">
                    <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Permissões:</span>
                    ${isAdm ? `
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25">
                            <i class="fa-solid fa-unlock-keyhole"></i> Acesso Total Irrestrito (Administrador)
                        </span>
                    ` : permBadgesDef.map(pb => {
                        const enabled = Boolean(perms[pb.key]);
                        if (isCurrentUserAdmin) {
                            return `
                                <button type="button" onclick="toggleMemberSinglePermission('${escapeHtml(login)}', '${pb.key}')" title="${escapeHtml(pb.desc)} • Clique para alternar" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${enabled ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25' : 'bg-slate-100 dark:bg-slate-800/80 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 hover:border-slate-400'}">
                                    <i class="fa-solid ${enabled ? 'fa-toggle-on text-emerald-500 text-sm' : 'fa-toggle-off text-slate-400 text-sm'}"></i>
                                    <i class="fa-solid ${pb.icon} text-[10px]"></i>
                                    <span>${pb.label}</span>
                                </button>
                            `;
                        } else {
                            return `
                                <span title="${escapeHtml(pb.desc)}" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${enabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : 'bg-slate-100 dark:bg-slate-800/60 text-slate-400 border-slate-200 dark:border-slate-800 line-through opacity-60'}">
                                    <i class="fa-solid ${enabled ? 'fa-check' : 'fa-xmark'} text-[10px]"></i>
                                    <span>${pb.label}</span>
                                </span>
                            `;
                        }
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');
}

async function toggleMemberSinglePermission(usernameKey, permKey) {
    if (!isCurrentUserAdmin) {
        showToast('Apenas Administradores podem modificar as permissões de cada membro.', 'error');
        return;
    }
    const user = registeredUsersCache.find(u => String(u.id).toLowerCase() === usernameKey.toLowerCase());
    if (!user) return;

    const currentPerms = normalizePermissions(user.permissions, user.role);
    currentPerms[permKey] = !currentPerms[permKey];
    user.permissions = currentPerms;
    user.updatedAt = Date.now();

    await saveUserAccountToCloud(usernameKey.toLowerCase(), user);

    if (usernameKey.toLowerCase() === String(currentUserLogin).toLowerCase()) {
        currentUserPermissions = normalizePermissions(user.permissions, user.role);
        updateHeaderSessionUI();
        renderAll();
    }

    await refreshUserDirectoryList();
    showToast(`Permissão atualizada para "${user.fullName || usernameKey}".`, 'success');
}

async function applyMemberPermissionPreset(usernameKey, presetKey) {
    if (!presetKey) return;
    if (!isCurrentUserAdmin) {
        showToast('Apenas Administradores podem aplicar perfis de permissão.', 'error');
        return;
    }
    const preset = PERMISSION_PRESETS[presetKey];
    if (!preset) return;

    const user = registeredUsersCache.find(u => String(u.id).toLowerCase() === usernameKey.toLowerCase());
    if (!user) return;

    user.permissions = {
        canCreate: preset.canCreate,
        canEdit: preset.canEdit,
        canChangeStatus: preset.canChangeStatus,
        canDelete: preset.canDelete,
        canManageSubtasks: preset.canManageSubtasks,
        canExportImport: preset.canExportImport
    };
    user.updatedAt = Date.now();

    await saveUserAccountToCloud(usernameKey.toLowerCase(), user);

    if (usernameKey.toLowerCase() === String(currentUserLogin).toLowerCase()) {
        currentUserPermissions = normalizePermissions(user.permissions, user.role);
        updateHeaderSessionUI();
        renderAll();
    }

    await refreshUserDirectoryList();
    showToast(`Perfil "${preset.label}" aplicado para ${user.fullName || usernameKey}!`, 'success');
}

async function handleDirectoryCreateUser(event) {
    event.preventDefault();
    const fullName = document.getElementById('dirFullNameInput').value.trim();
    const rawLogin = document.getElementById('dirUsernameInput').value.trim().toLowerCase();
    const cleanLogin = rawLogin.replace(/[^a-z0-9._-]/gi, '');
    const rawWhatsapp = (document.getElementById('dirWhatsappInput')?.value || '').trim();
    const cleanWhatsappDigits = rawWhatsapp.replace(/\D/g, '');
    const rawPass = document.getElementById('dirPasswordInput').value;
    const role = document.getElementById('dirRoleSelect').value === 'admin' ? 'admin' : 'member';
    const btn = document.getElementById('dirCreateBtn');

    if (!fullName || !cleanLogin || !rawPass) {
        showToast('Preencha nome, login, WhatsApp e senha.', 'error');
        return;
    }
    if (!cleanWhatsappDigits || cleanWhatsappDigits.length < 10) {
        showToast('Informe um número de WhatsApp válido com DDD.', 'error');
        return;
    }

    if (role === 'admin' && !isCurrentUserAdmin && registeredUsersCache.some(u => u.role === 'admin')) {
        showToast('Apenas um Administrador ativo pode cadastrar outro Administrador.', 'error');
        return;
    }

    await fetchAllUsersFromCloud();
    if (registeredUsersCache.some(u => String(u.id).toLowerCase() === cleanLogin)) {
        showToast(`O login "@${cleanLogin}" já existe.`, 'error');
        return;
    }

    const customPermissions = normalizePermissions({
        canCreate: Boolean(document.getElementById('dirPermCreate')?.checked),
        canEdit: Boolean(document.getElementById('dirPermEdit')?.checked),
        canChangeStatus: Boolean(document.getElementById('dirPermStatus')?.checked),
        canManageSubtasks: Boolean(document.getElementById('dirPermStatus')?.checked),
        canDelete: Boolean(document.getElementById('dirPermDelete')?.checked),
        canExportImport: Boolean(document.getElementById('dirPermBackup')?.checked)
    }, role);

    btn.disabled = true;
    try {
        const passHash = await computeSha256Hex(`user::${cleanLogin}::${rawPass}`);
        const userObj = {
            id: cleanLogin,
            fullName,
            whatsapp: rawWhatsapp,
            recoveryToken: btoa(unescape(encodeURIComponent(rawPass))),
            role,
            status: 'active',
            permissions: customPermissions,
            passwordHash: passHash,
            createdBy: currentAuthor || 'Administrador',
            createdAt: Date.now()
        };

        await saveUserAccountToCloud(cleanLogin, userObj);
        document.getElementById('dirFullNameInput').value = '';
        document.getElementById('dirUsernameInput').value = '';
        const dirWInp = document.getElementById('dirWhatsappInput');
        if (dirWInp) dirWInp.value = '';
        document.getElementById('dirPasswordInput').value = '';
        await refreshUserDirectoryList();
        showToast(`Cadastro e permissões de "${fullName}" (@${cleanLogin}) autorizados e salvos!`, 'success');
    } finally {
        btn.disabled = false;
    }
}

async function approvePendingUser(usernameKey) {
    if (!isCurrentUserAdmin) {
        showToast('Apenas Administradores podem autorizar novos cadastros.', 'error');
        return;
    }
    const user = registeredUsersCache.find(u => String(u.id).toLowerCase() === usernameKey.toLowerCase());
    if (!user) return;

    user.status = 'active';
    user.approvedBy = currentAuthor || currentUserLogin;
    user.updatedAt = Date.now();

    await saveUserAccountToCloud(usernameKey.toLowerCase(), user);
    await refreshUserDirectoryList();
    showToast(`Cadastro de "${user.fullName || usernameKey}" autorizado com sucesso!`, 'success');
}

async function toggleDirectoryUserRole(usernameKey) {
    if (!isCurrentUserAdmin) {
        showToast('Apenas Administradores podem alterar cargos de contas.', 'error');
        return;
    }
    const user = registeredUsersCache.find(u => String(u.id).toLowerCase() === usernameKey.toLowerCase());
    if (!user) return;

    user.role = user.role === 'admin' ? 'member' : 'admin';
    user.permissions = normalizePermissions(user.permissions, user.role);
    user.updatedAt = Date.now();
    await saveUserAccountToCloud(usernameKey.toLowerCase(), user);

    if (usernameKey.toLowerCase() === String(currentUserLogin).toLowerCase()) {
        currentUserRole = user.role;
        currentUserPermissions = normalizePermissions(user.permissions, user.role);
        isCurrentUserAdmin = user.role === 'admin';
        updateHeaderSessionUI();
        renderAll();
    }

    await refreshUserDirectoryList();
    showToast(`Perfil de "${user.fullName}" alterado para ${user.role === 'admin' ? 'Administrador' : 'Membro'}.`, 'success');
}

async function deleteDirectoryUser(usernameKey) {
    if (!isCurrentUserAdmin) {
        showToast('Apenas Administradores podem remover contas.', 'error');
        return;
    }
    await deleteUserAccountFromCloud(usernameKey.toLowerCase());
    await refreshUserDirectoryList();
    showToast(`Conta "@${usernameKey}" removida.`, 'info');
}

/*************************************************************************
 * 16. VISUALIZAÇÃO DE SENHAS PELO ADMINISTRADOR E MODO LISTA SIMPLIFICADA
 *************************************************************************/
function getDecodedUserPassword(userObj) {
    if (!userObj) return '';
    if (userObj.recoveryToken) {
        try {
            return decodeURIComponent(escape(atob(userObj.recoveryToken)));
        } catch (e) {}
    }
    return '';
}

async function adminSetUserPasswordInDirectory(usernameKey, newPlainPassword) {
    if (!isCurrentUserAdmin) {
        showToast('Apenas o Administrador pode visualizar ou alterar senhas de membros.', 'error');
        return;
    }
    const cleanPass = String(newPlainPassword || '').trim();
    if (!cleanPass || cleanPass.length < 3) {
        showToast('A senha deve ter pelo menos 3 caracteres.', 'error');
        await refreshUserDirectoryList();
        return;
    }
    await fetchAllUsersFromCloud();
    const user = registeredUsersCache.find(u => normalizeIdentityStr(u.id) === normalizeIdentityStr(usernameKey));
    if (!user) return;

    const cleanLogin = String(user.id).toLowerCase();
    user.passwordHash = await computeSha256Hex(`user::${cleanLogin}::${cleanPass}`);
    user.recoveryToken = btoa(unescape(encodeURIComponent(cleanPass)));
    user.updatedAt = Date.now();

    await saveUserAccountToCloud(cleanLogin, user);
    await refreshUserDirectoryList();
    showToast(`Senha de "${user.fullName || user.id}" atualizada para "${cleanPass}".`, 'success');
}
