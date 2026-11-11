// =========================================================================
// 6. js/whatsapp-api.js — Integração com API do WhatsApp (Meta Cloud API,
//    Evolution API, Z-API / Webhook e api.whatsapp.com) & Recuperação de Senha
// =========================================================================

/*************************************************************************
 * 15. CADASTRO DE WHATSAPP E RECUPERAÇÃO DE SENHA VIA WHATSAPP
 *************************************************************************/
function normalizeWhatsAppPhoneForLink(rawPhone) {
    let digits = String(rawPhone || '').replace(/\D/g, '');
    if (!digits) return '';
    // Se tiver 10 ou 11 dígitos (DDD + número no Brasil), adiciona o DDI 55 automaticamente
    if (digits.length === 10 || digits.length === 11) {
        digits = '55' + digits;
    }
    return digits;
}

async function updateUserWhatsappInDirectory(usernameKey, newWhatsappVal) {
    if (!isCurrentUserAdmin) {
        showToast('Apenas o Administrador pode editar o WhatsApp no cadastro.', 'error');
        return;
    }
    await fetchAllUsersFromCloud();
    const user = registeredUsersCache.find(u => normalizeIdentityStr(u.id) === normalizeIdentityStr(usernameKey));
    if (!user) return;

    user.whatsapp = (newWhatsappVal || '').trim();
    user.updatedAt = Date.now();
    await saveUserAccountToCloud(String(user.id).toLowerCase(), user);
    await refreshUserDirectoryList();
    showToast(`WhatsApp de "${user.fullName || user.id}" atualizado para ${user.whatsapp || 'vazio'}.`, 'success');
}

async function sendUserPasswordViaWhatsApp(usernameKey) {
    await fetchAllUsersFromCloud();
    const user = registeredUsersCache.find(u => normalizeIdentityStr(u.id) === normalizeIdentityStr(usernameKey));
    if (!user) {
        showToast('Usuário não encontrado.', 'error');
        return;
    }

    const phoneDigits = normalizeWhatsAppPhoneForLink(user.whatsapp);
    if (!phoneDigits || phoneDigits.length < 12) {
        const msg = 'Este usuário ainda não possui um número de WhatsApp válido cadastrado. Peça ao Administrador para preencher o WhatsApp em "Cadastro & Permissões".';
        showAuthModalAlert(msg, 'error');
        showToast(msg, 'error');
        return;
    }

    let plainPassword = '';
    if (user.recoveryToken) {
        try {
            plainPassword = decodeURIComponent(escape(atob(user.recoveryToken)));
        } catch (e) {
            plainPassword = '';
        }
    }

    // Caso seja uma conta antiga cadastrada antes do recurso de recuperação, gera uma nova senha automática e atualiza o cadastro
    if (!plainPassword) {
        plainPassword = 'TF' + Math.floor(100000 + Math.random() * 900000);
        user.passwordHash = await computeSha256Hex(`user::${String(user.id).toLowerCase()}::${plainPassword}`);
        user.recoveryToken = btoa(unescape(encodeURIComponent(plainPassword)));
        user.updatedAt = Date.now();
        await saveUserAccountToCloud(String(user.id).toLowerCase(), user);
    }

    const roleLabel = user.role === 'admin' ? 'Administrador' : 'Membro';
    const textMsg =
        `🔐 *Recuperação de Senha — TaskFlow Pro Engenharia*

` +
        `Olá, *${user.fullName || user.id}*!
` +
        `Aqui estão os seus dados de acesso ao sistema:

` +
        `👤 *Login:* @${user.id}
` +
        `🏷️ *Perfil:* ${roleLabel}
` +
        `🔑 *Sua Senha:* ${plainPassword}

` +
        `_Utilize esta senha na tela de acesso para entrar na sua sala._`;

    const sentViaHttp = await dispatchWhatsAppApiMessage(phoneDigits, textMsg);
    const feedback = sentViaHttp.mode === 'http'
        ? `Senha enviada diretamente via API do WhatsApp (${sentViaHttp.providerLabel}) para ${user.whatsapp}!`
        : `Enviando senha via API Oficial do WhatsApp (${user.whatsapp}) para "${user.fullName || user.id}"!`;
    showAuthModalAlert(feedback, 'success');
    showToast(feedback, 'success');
}

async function recoverPasswordViaWhatsApp() {
    const selectEl = document.getElementById('authUserSelect');
    const selectedLogin = (selectEl?.value || '').trim().toLowerCase();
    if (!selectedLogin) {
        showAuthModalAlert('Selecione primeiro o seu Usuário / Login na lista acima para recuperar a senha via WhatsApp.', 'error');
        return;
    }
    await sendUserPasswordViaWhatsApp(selectedLogin);
}

/*************************************************************************
 * 17. MOTOR DE INTEGRAÇÃO COM A API DO WHATSAPP (META CLOUD API,
 *     EVOLUTION API, Z-API / WEBHOOK REST & API.WHATSAPP.COM)
 *************************************************************************/
const WHATSAPP_API_CONFIG_KEY = 'taskflow_pro_whatsapp_api_config_v1';

function getWhatsAppApiConfig() {
    try {
        const raw = localStorage.getItem(WHATSAPP_API_CONFIG_KEY);
        if (raw) {
            return JSON.parse(raw);
        }
    } catch (e) {}
    return {
        provider: 'direct_api', // 'meta_cloud' | 'evolution' | 'zapi' | 'direct_api'
        metaPhoneId: '',
        metaToken: '',
        customUrl: '',
        customApiKey: '',
        autoNotifyAssign: false
    };
}

function loadWhatsAppApiFormUI() {
    const cfg = getWhatsAppApiConfig();
    const provSel = document.getElementById('waApiProviderSelect');
    const phoneInp = document.getElementById('waMetaPhoneIdInput');
    const tokInp = document.getElementById('waMetaTokenInput');
    const urlInp = document.getElementById('waCustomUrlInput');
    const keyInp = document.getElementById('waCustomApiKeyInput');
    const autoChk = document.getElementById('waAutoNotifyAssignToggle');

    if (provSel) provSel.value = cfg.provider || 'direct_api';
    if (phoneInp) phoneInp.value = cfg.metaPhoneId || '';
    if (tokInp) tokInp.value = cfg.metaToken || '';
    if (urlInp) urlInp.value = cfg.customUrl || '';
    if (keyInp) keyInp.value = cfg.customApiKey || '';
    if (autoChk) autoChk.checked = Boolean(cfg.autoNotifyAssign);

    handleWaApiProviderChange();
}

function handleWaApiProviderChange() {
    const prov = document.getElementById('waApiProviderSelect')?.value || 'direct_api';
    const metaBox = document.getElementById('waConfigMetaFields');
    const customBox = document.getElementById('waConfigCustomFields');
    const badge = document.getElementById('waApiActiveModeBadge');

    if (metaBox) metaBox.classList.toggle('hidden', prov !== 'meta_cloud');
    if (customBox) customBox.classList.toggle('hidden', prov !== 'evolution' && prov !== 'zapi');

    if (badge) {
        const labels = {
            meta_cloud: 'Meta Cloud API',
            evolution: 'Evolution API REST',
            zapi: 'Z-API / Webhook',
            direct_api: 'api.whatsapp.com'
        };
        badge.textContent = labels[prov] || 'API Ativa';
    }
}

function saveWhatsAppApiSettings() {
    if (!isCurrentUserAdmin) {
        showToast('Apenas o Administrador pode configurar a API do WhatsApp.', 'error');
        return;
    }
    const cfg = {
        provider: document.getElementById('waApiProviderSelect')?.value || 'direct_api',
        metaPhoneId: (document.getElementById('waMetaPhoneIdInput')?.value || '').trim(),
        metaToken: (document.getElementById('waMetaTokenInput')?.value || '').trim(),
        customUrl: (document.getElementById('waCustomUrlInput')?.value || '').trim(),
        customApiKey: (document.getElementById('waCustomApiKeyInput')?.value || '').trim(),
        autoNotifyAssign: Boolean(document.getElementById('waAutoNotifyAssignToggle')?.checked)
    };
    localStorage.setItem(WHATSAPP_API_CONFIG_KEY, JSON.stringify(cfg));
    handleWaApiProviderChange();
    showToast('Configurações da API do WhatsApp salvas com sucesso!', 'success');
}

// Sobrescreve openAdminPanelModal para carregar automaticamente as configurações da API do WhatsApp
const _origOpenAdminPanelModalV16 = openAdminPanelModal;
openAdminPanelModal = function() {
    _origOpenAdminPanelModalV16();
    if (isCurrentUserAdmin) {
        loadWhatsAppApiFormUI();
    }
};

/**
 * Envia uma mensagem de WhatsApp usando a API configurada:
 * 1. Meta WhatsApp Cloud API Oficial: POST https://graph.facebook.com/v20.0/{phone_number_id}/messages
 * 2. Evolution API v2: POST {customUrl} com payload { number, text }
 * 3. Z-API / Webhook REST: POST {customUrl} com payload { phone, message, number, text }
 * 4. API Direta Oficial do WhatsApp: https://api.whatsapp.com/send?phone={phone}&text={text}
 */
async function dispatchWhatsAppApiMessage(phoneDigits, messageText) {
    const cleanDigits = normalizeWhatsAppPhoneForLink(phoneDigits);
    const cfg = getWhatsAppApiConfig();

    // 1. Meta WhatsApp Cloud API Oficial
    if (cfg.provider === 'meta_cloud' && cfg.metaPhoneId && cfg.metaToken) {
        try {
            const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(cfg.metaPhoneId)}/messages`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${cfg.metaToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: cleanDigits,
                    type: 'text',
                    text: { preview_url: false, body: messageText }
                })
            });
            if (response.ok) {
                return { ok: true, mode: 'http', providerLabel: 'Meta Cloud API' };
            } else {
                const errData = await response.json().catch(() => ({}));
                showToast(`Aviso Meta Cloud API (${response.status}): usando fallback api.whatsapp.com`, 'info');
            }
        } catch (err) {
            showToast('Falha de rede na Meta Cloud API. Redirecionando via api.whatsapp.com...', 'info');
        }
    }

    // 2. Evolution API ou Z-API / Webhook REST
    if ((cfg.provider === 'evolution' || cfg.provider === 'zapi') && cfg.customUrl) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (cfg.customApiKey) {
                headers['apikey'] = cfg.customApiKey;
                headers['Client-Token'] = cfg.customApiKey;
                headers['Authorization'] = cfg.customApiKey.startsWith('Bearer ') ? cfg.customApiKey : `Bearer ${cfg.customApiKey}`;
            }
            const payload = cfg.provider === 'evolution'
                ? { number: cleanDigits, text: messageText, options: { delay: 500, presence: 'composing' } }
                : { phone: cleanDigits, message: messageText, number: cleanDigits, text: messageText };

            const response = await fetch(cfg.customUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });
            if (response.ok) {
                return { ok: true, mode: 'http', providerLabel: cfg.provider === 'evolution' ? 'Evolution API' : 'Z-API / Webhook' };
            } else {
                showToast(`Aviso API (${response.status}): abrindo fallback api.whatsapp.com`, 'info');
            }
        } catch (err) {
            showToast('Erro de conexão com o endpoint REST. Abrindo api.whatsapp.com...', 'info');
        }
    }

    // 3. API Oficial Direta (https://api.whatsapp.com/send)
    const directApiUrl = `https://api.whatsapp.com/send?phone=${encodeURIComponent(cleanDigits)}&text=${encodeURIComponent(messageText)}`;
    window.open(directApiUrl, '_blank', 'noopener,noreferrer');
    return { ok: true, mode: 'direct_api', providerLabel: 'api.whatsapp.com/send' };
}

async function testWhatsAppApiConnection() {
    saveWhatsAppApiSettings();
    await fetchAllUsersFromCloud();
    const me = registeredUsersCache.find(u => normalizeIdentityStr(u.id) === normalizeIdentityStr(currentUserLogin)) || registeredUsersCache[0];
    const targetPhone = me?.whatsapp || '';

    if (!targetPhone) {
        showToast('Cadastre primeiro um número de WhatsApp na sua conta em "Cadastro & Permissões" para testar o disparo.', 'error');
        return;
    }

    const testMsg =
        `✅ *Teste de Integração API WhatsApp — TaskFlow Pro Engenharia*

` +
        `Olá, *${me.fullName || me.id}*!
` +
        `A integração com a API do WhatsApp está ativa e configurada para envio de senhas e notificações de tarefas.`;

    const res = await dispatchWhatsAppApiMessage(targetPhone, testMsg);
    showToast(`Disparo de teste executado via ${res.providerLabel} para ${targetPhone}!`, 'success');
}

// Notificação automática opcional via API do WhatsApp quando uma tarefa ou subtarefa é atribuída a um membro
async function notifyAssigneeViaWhatsAppIfEnabled(memberNameOrLogin, itemTitle, parentOrderTitle = '') {
    const cfg = getWhatsAppApiConfig();
    if (!cfg.autoNotifyAssign || !memberNameOrLogin) return;

    await fetchAllUsersFromCloud();
    const assignees = typeof parseAssigneesList === 'function'
        ? parseAssigneesList(memberNameOrLogin)
        : String(memberNameOrLogin || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean);

    for (const singleAssignee of assignees) {
        const matchedUser = registeredUsersCache.find(u => doesAssigneeMatchUser(singleAssignee, u));
        if (!matchedUser || !matchedUser.whatsapp) continue;

        const msg = parentOrderTitle
            ? `📌 *Nova Subtarefa Atribuída — TaskFlow Engenharia*

Olá, *${matchedUser.fullName || matchedUser.id}*!
Você foi definido como responsável pelo item:
🔹 *${itemTitle}*
📂 Pedido: *${parentOrderTitle}*`
            : `📋 *Nova Tarefa Atribuída — TaskFlow Engenharia*

Olá, *${matchedUser.fullName || matchedUser.id}*!
Você foi definido como responsável principal pela tarefa:
📂 *${itemTitle}*`;

        await dispatchWhatsAppApiMessage(matchedUser.whatsapp, msg);
    }
}

const _origUpdateCardTaskAssigneeV16 = updateCardTaskAssignee;
updateCardTaskAssignee = async function(taskId, newAssignee) {
    await _origUpdateCardTaskAssigneeV16(taskId, newAssignee);
    const task = tasks.find(t => t.id === taskId);
    if (task && task.author) {
        await notifyAssigneeViaWhatsAppIfEnabled(task.author, task.title);
    }
};

const _origUpdateCardSubtaskAssigneeV16 = updateCardSubtaskAssignee;
updateCardSubtaskAssignee = async function(taskId, subIdx, newAssignee) {
    await _origUpdateCardSubtaskAssigneeV16(taskId, subIdx, newAssignee);
    const task = tasks.find(t => t.id === taskId);
    const sub = task?.subtasks?.[subIdx];
    if (task && sub && sub.assignee) {
        await notifyAssigneeViaWhatsAppIfEnabled(sub.assignee, sub.text, task.title);
    }
};

// Run app when window loads
window.onload = function() {
    initApp();
};
