// =========================================================================
// 1. js/config-state.js — Estado Global, Constantes, Datas, Tema e Toasts
// =========================================================================

/**************************************************************
 * 1. CONFIGURAÇÃO FIREBASE CLOUD FIRESTORE + CACHE LOCAL HÍBRIDO
 *    Você pode colar suas credenciais abaixo em DEFAULT_FIREBASE_CONFIG
 *    OU configurar diretamente pela interface no Painel do Administrador!
 **************************************************************/
const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyBlU4hRA--am6JLLhL0HPUthonsnat5y_0",
    authDomain: "taskflow-7a6b1.firebaseapp.com",
    databaseURL: "https://taskflow-7a6b1-default-rtdb.firebaseio.com",
    projectId: "taskflow-7a6b1",
    storageBucket: "taskflow-7a6b1.firebasestorage.app",
    messagingSenderId: "671544318958",
    appId: "1:671544318958:web:ee217f1b0571745eb98cff"
};

const FIREBASE_CUSTOM_CONFIG_KEY = 'taskflow_pro_firebase_config_v1';
const ROOMS_CONFIG_COLLECTION = 'salas_config_v4';
const USERS_CONFIG_COLLECTION = 'usuarios_config_v4';
const UNIFIED_TASKS_COLLECTION = 'tarefas_unificadas_v8';

let db = null;
let firebaseConnected = false;
let firestoreTasksUnsubscribe = null;
let firestoreUsersUnsubscribe = null;
let firestoreRoomsUnsubscribe = null;

/**************************************************************
 * 2. SHA-256 HASH & STATE CONSTANTS
 **************************************************************/
async function computeSha256Hex(input) {
    try {
        const msgUint8 = new TextEncoder().encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        let h1 = 0xdeadbeef ^ input.length;
        let h2 = 0x41c6ce57 ^ input.length;
        for (let i = 0, ch; i < input.length; i++) {
            ch = input.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
    }
}

const STORAGE_KEY_PREFIX = 'taskflow_pro_tasks_v4_';
const SESSION_KEY = 'taskflow_pro_session_v4';
const LOCAL_ROOM_CONFIG_KEY = 'taskflow_pro_room_hashes_v4';
const LOCAL_USERS_CONFIG_KEY = 'taskflow_pro_users_v4';
const AUTHOR_KEY = 'taskflow_pro_author_v3';
const THEME_KEY = 'taskflow_pro_theme';

let currentWorkspace = '';
let currentRoomPasswordHash = '';
let currentRoomAdminHash = '';
let currentAuthor = localStorage.getItem(AUTHOR_KEY) || '';
let currentUserLogin = '';
let currentUserRole = 'member'; // 'member' | 'admin'
let currentUserPermissions = {
    canCreate: true,
    canEdit: true,
    canChangeStatus: true,
    canDelete: true,
    canManageSubtasks: true,
    canExportImport: true
};
let isAuthenticated = false;
let isCurrentUserAdmin = false;
let currentAuthMode = 'join'; // 'join' | 'register_user' | 'create'
let availableRoomsCache = [];
let registeredUsersCache = [];

const DEFAULT_MEMBER_PERMISSIONS = {
    canCreate: true,
    canEdit: true,
    canChangeStatus: true,
    canDelete: true,
    canManageSubtasks: true,
    canExportImport: true
};

const PERMISSION_PRESETS = {
    full: {
        label: 'Editor Completo',
        canCreate: true,
        canEdit: true,
        canChangeStatus: true,
        canDelete: true,
        canManageSubtasks: true,
        canExportImport: true
    },
    collaborator: {
        label: 'Colaborador',
        canCreate: true,
        canEdit: true,
        canChangeStatus: true,
        canDelete: false,
        canManageSubtasks: true,
        canExportImport: false
    },
    status_only: {
        label: 'Operador de Status',
        canCreate: false,
        canEdit: false,
        canChangeStatus: true,
        canDelete: false,
        canManageSubtasks: true,
        canExportImport: false
    },
    viewer: {
        label: 'Somente Leitura',
        canCreate: false,
        canEdit: false,
        canChangeStatus: false,
        canDelete: false,
        canManageSubtasks: false,
        canExportImport: false
    }
};

function normalizePermissions(rawPerms, role = 'member') {
    if (role === 'admin') {
        return {
            canCreate: true,
            canEdit: true,
            canChangeStatus: true,
            canDelete: true,
            canManageSubtasks: true,
            canExportImport: true
        };
    }
    const base = { ...DEFAULT_MEMBER_PERMISSIONS };
    if (rawPerms && typeof rawPerms === 'object') {
        Object.keys(base).forEach(k => {
            if (typeof rawPerms[k] === 'boolean') {
                base[k] = rawPerms[k];
            }
        });
    }
    return base;
}

function hasUserPermission(permKey) {
    if (isCurrentUserAdmin || currentUserRole === 'admin') return true;
    const perms = normalizePermissions(currentUserPermissions, currentUserRole);
    return Boolean(perms[permKey]);
}

let tasks = [];
let currentCategory = 'all';
let currentView = 'kanban';
let modalSubtasks = [];
let draggedTaskId = null;
let isApplyingRemoteUpdate = false;
let restPollingInterval = null;
let lastSyncTimestamp = null;

// Pomodoro State
let pomoInterval = null;
let pomoTimeLeft = 25 * 60;
let pomoIsRunning = false;
let pomoMode = 'focus';

const CATEGORY_META = {
    domestico: {
        label: 'Doméstico',
        icon: 'fa-house',
        badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
        borderClass: 'border-l-4 border-l-emerald-500',
        dotClass: 'bg-emerald-500'
    },
    academico: {
        label: 'Acadêmico',
        icon: 'fa-graduation-cap',
        badgeClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
        borderClass: 'border-l-4 border-l-indigo-500',
        dotClass: 'bg-indigo-500'
    },
    servico: {
        label: 'Serviço',
        icon: 'fa-briefcase',
        badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
        borderClass: 'border-l-4 border-l-amber-500',
        dotClass: 'bg-amber-500'
    }
};

const PRIORITY_META = {
    urgente: { label: 'Urgente', weight: 4, badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30', icon: 'fa-fire' },
    alta:    { label: 'Alta',    weight: 3, badgeClass: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30', icon: 'fa-bolt' },
    media:   { label: 'Média',   weight: 2, badgeClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30', icon: 'fa-thumbtack' },
    baixa:   { label: 'Baixa',   weight: 1, badgeClass: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30', icon: 'fa-seedling' }
};

const STATUS_META = {
    todo:        { label: 'A Fazer',       icon: 'fa-regular fa-circle',        color: 'text-slate-500' },
    in_progress: { label: 'Em Andamento',  icon: 'fa-solid fa-spinner',         color: 'text-indigo-500' },
    waiting:     { label: 'Aguardando',    icon: 'fa-solid fa-circle-pause',    color: 'text-amber-500' },
    done:        { label: 'Concluído',     icon: 'fa-solid fa-circle-check',    color: 'text-emerald-500' }
};

function getCollectionName() {
    const cleanRoom = (currentWorkspace || 'geral').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'geral';
    return `tarefas_${cleanRoom}`;
}

function getStorageKey() {
    return STORAGE_KEY_PREFIX + getCollectionName();
}

/**************************************************************
 * 6. DATE HELPERS & APP INIT
 **************************************************************/
function getLocalDateStr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return 'Sem data';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

function getDueDateStatus(dueDateStr, taskStatus) {
    if (taskStatus === 'done' || !dueDateStr) return 'normal';
    const today = getLocalDateStr(0);
    if (dueDateStr < today) return 'overdue';
    if (dueDateStr === today) return 'today';
    return 'upcoming';
}

function toggleTheme() {
    const html = document.documentElement;
    const icon = document.getElementById('themeIcon');
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.setItem(THEME_KEY, 'light');
        icon.className = 'fa-solid fa-moon';
    } else {
        html.classList.add('dark');
        localStorage.setItem(THEME_KEY, 'dark');
        icon.className = 'fa-solid fa-sun';
    }
}

function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const icon = document.getElementById('themeIcon');
    if (saved === 'light') {
        document.documentElement.classList.remove('dark');
        if (icon) icon.className = 'fa-solid fa-moon';
    } else {
        document.documentElement.classList.add('dark');
        if (icon) icon.className = 'fa-solid fa-sun';
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');

    let bgClass = 'bg-slate-900 text-white border-slate-800';
    let icon = 'fa-circle-info text-indigo-400';
    if (type === 'success') {
        bgClass = 'bg-emerald-600 text-white border-emerald-500';
        icon = 'fa-circle-check text-white';
    } else if (type === 'error') {
        bgClass = 'bg-rose-600 text-white border-rose-500';
        icon = 'fa-circle-exclamation text-white';
    }

    toast.className = `pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl border text-xs font-semibold transition-all transform translate-y-2 opacity-0 ${bgClass}`;
    toast.innerHTML = `<i class="fa-solid ${icon} text-sm"></i><span class="flex-1">${escapeHtml(message)}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('translate-y-2', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ==========================================================
// CONTROLE DE LAYOUT (SUPERIOR, ESQUERDA, DIREITA) E SIDEBAR
// ==========================================================
const LAYOUT_KEY = 'taskflow_pro_layout_v1';
const SIDEBAR_KEY = 'taskflow_pro_sidebar_state_v1';

function changeLayout(mode) {
    localStorage.setItem(LAYOUT_KEY, mode);
    applyLayout(mode);
}

function applyLayout(mode) {
    if (!mode) mode = localStorage.getItem(LAYOUT_KEY) || 'top';
    document.body.setAttribute('data-layout', mode);
}

function toggleSidebar() {
    const current = document.body.getAttribute('data-sidebar');
    const newState = current === 'collapsed' ? 'expanded' : 'collapsed';
    localStorage.setItem(SIDEBAR_KEY, newState);
    applySidebarState(newState);
}

function applySidebarState(state) {
    if (!state) state = localStorage.getItem(SIDEBAR_KEY) || 'expanded';
    document.body.setAttribute('data-sidebar', state);
}


// ==========================================================
// FORMATAÇÃO E PRECISÃO DE HORAS (MÍNIMO 0.1h • 1 CASA DECIMAL)
// ==========================================================
function roundHours1Dec(val, fallback = 0.1) {
    const num = parseFloat(String(val ?? '').replace(',', '.'));
    if (isNaN(num) || num <= 0) return fallback;
    return Math.max(0.1, Math.round(num * 10) / 10);
}

function formatTotalHours1Dec(val) {
    const num = Number(val) || 0;
    return (Math.round(num * 10) / 10).toFixed(1);
}

function formatHoursClean(val) {
    const num = Number(val) || 0;
    const r = Math.round(num * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
}


// ==========================================================
// UTILITÁRIOS DE SEGURANÇA (ESCAPE JS INLINE & UTF-8 BASE64)
// ==========================================================
function escapeJsAttr(str) {
    if (str === null || str === undefined) return '';
    return escapeHtml(
        String(str)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n')
    );
}

function encodeUtf8Base64(str) {
    if (!str) return '';
    try {
        const bytes = new TextEncoder().encode(String(str));
        let bin = '';
        bytes.forEach(b => { bin += String.fromCharCode(b); });
        return btoa(bin);
    } catch (e) {
        return '';
    }
}

function decodeUtf8Base64(b64) {
    if (!b64) return '';
    try {
        const bin = atob(String(b64));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
            bytes[i] = bin.charCodeAt(i);
        }
        return new TextDecoder().decode(bytes);
    } catch (e) {
        return '';
    }
}

const SORT_MODE_KEY = 'taskflow_pro_sort_mode_v1';
window._currentSortMode = localStorage.getItem(SORT_MODE_KEY) || 'dueDate';
function setSavedSortMode(mode) {
    window._currentSortMode = mode || 'dueDate';
    try {
        localStorage.setItem(SORT_MODE_KEY, window._currentSortMode);
    } catch (e) {}
}
