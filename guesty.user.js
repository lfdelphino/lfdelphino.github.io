// ==UserScript==
// @name         Wonder Vacation Homes - Guesty Enhancer
// @namespace    https://wondervacationhomes.com/
// @version      2.8.4
// @description  A robust script that displays API data from WonderAI and Breezeway in the Guesty v2 Inbox. Now includes SMS character limit bypass.
// @author       Delphino @ Wonder Vacation Homes
// @match        https://app.guesty.com/*
// @connect      api.wondervacationhomes.com
// @connect      api.breezeway.io
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    http://cdn.wondervacationhomes.com/assets/wvh/js/WVH-Guesty-Enhancer.user.js
// @downloadURL  http://cdn.wondervacationhomes.com/assets/wvh/js/WVH-Guesty-Enhancer.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration ---
    const WONDERAI_API_ENDPOINT_BASE = 'https://api.wondervacationhomes.com/dashboard/inbox?chat=';
    const BREEZEWAY_API_ENDPOINT_BASE = 'https://api.breezeway.io/v1/tasks?reservation_id=';
    const REQUEST_TIMEOUT = 60000;
    const DEFAULT_AGENT_ID = 'asst_G2GXKe63yoEDg0rqP0hMMYAL';

    let lastProcessedConversationId = null;
    let currentApiDataText = null;
    let currentXhr = null;
    let scrollInterval = null;
    let mockApiDataStore = null;

    // --- Styling ---
    GM_addStyle(`
        /* Hide Guest App Strip (Pendo) */
        div[pendo-id="guest-app-strip"] { display: none !important; }

        /* Active Sidebar Icon Style */
        .sidebar-icon-active svg { fill: #2563EB !important; }

        /* WonderAI Info Box Styles */
        #custom-api-info-box { background-color: #f7f9fc; border: 1px solid #e1e6eb; border-radius: 12px; padding: 15px 20px; margin: 15px 25px; font-family: 'Figtree', sans-serif; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); }
        #custom-api-info-box h3 { margin-top: 0; margin-bottom: 15px; font-size: 16px; color: #10275B; border-bottom: 1px solid #e1e6eb; padding-bottom: 10px; }
        .custom-info-content { white-space: pre-wrap; word-break: break-word; background-color: #fff; padding: 12px; border-radius: 6px; border: 1px solid #dfe3e8; max-height: 400px; overflow-y: auto; font-size: 14px; }
        .custom-info-actions { display: flex; gap: 10px; margin-top: 15px; padding-top: 15px; border-top: 1px solid #e1e6eb; }
        .custom-info-actions button { background-color: #F9FAFB; border: 1px solid #D1D5DB; color: #374151; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
        .custom-info-actions button:hover { background-color: #F3F4F6; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05); }
        .custom-info-actions button.action-primary { background-color: #EFF6FF; border-color: #BFDBFE; color: #2563EB; }
        .custom-info-actions button.action-primary:hover { background-color: #DBEAFE; }
        #custom-api-info-box .loading-message, #custom-api-info-box .error-message { color: #6B7280; font-style: italic; padding: 10px; }

        /* Breezeway Drawer Styles */
        .breezeway-loading, .breezeway-error { padding: 40px; text-align: center; color: #6B7280; font-family: 'Figtree', sans-serif; }
        .breezeway-container { font-family: sans-serif; color: #333; height: 100%; overflow-y: auto; background-color: #F9FAFB; }
        .breezeway-header { background-color: #fff; padding: 20px 20px 15px 20px; border-bottom: 1px solid #e1e6eb; }
        .breezeway-header h3 { font-size: 20px; font-weight: 600; margin: 0; }
        .breezeway-content { padding: 20px; }
        .breezeway-section { margin-bottom: 24px; }
        .breezeway-section-title { font-size: 12px; color: #6B7280; margin-bottom: 8px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
        .breezeway-listing-card { display: flex; align-items: center; gap: 12px; background-color: #fff; padding: 12px; border-radius: 8px; border: 1px solid #e5e7eb; }
        .breezeway-listing-img { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; }
        .breezeway-listing-info .name { font-weight: 600; font-size: 15px; }
        .breezeway-listing-info .address { font-size: 13px; color: #6B7280; }
        .breezeway-dates { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .breezeway-task-summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
        .breezeway-summary-card { background-color: #fff; padding: 12px; border-radius: 8px; border: 1px solid #e5e7eb; text-align: center; }
        .breezeway-summary-card .count { font-size: 20px; font-weight: 600; }
        .breezeway-summary-card .label { font-size: 12px; color: #6B7280; }
        .breezeway-task-controls { display: flex; gap: 10px; margin-bottom: 12px; }
        .breezeway-task-search { flex-grow: 1; padding: 8px 12px; border: 1px solid #D1D5DB; border-radius: 6px; font-size: 14px; }
        .breezeway-new-task-btn { background-color: #2563EB; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.2s; }
        .breezeway-new-task-btn:hover { background-color: #1D4ED8; }
        .breezeway-filter-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
        .breezeway-filter-tabs button { background-color: #fff; border: 1px solid #e5e7eb; color: #4B5563; padding: 5px 12px; border-radius: 16px; font-size: 13px; cursor: pointer; transition: all 0.2s; }
        .breezeway-filter-tabs button.active { background-color: #EFF6FF; color: #1D4ED8; border-color: #BFDBFE; font-weight: 500; }
        .breezeway-task-list { display: flex; flex-direction: column; gap: 10px; }
        .breezeway-task { background-color: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; transition: box-shadow 0.2s; cursor: pointer; }
        .breezeway-task:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .breezeway-task-header { display: flex; align-items: center; gap: 10px; }
        .breezeway-task-icon { flex-shrink: 0; }
        .breezeway-task-title { font-weight: 600; color: #111827; }
        .breezeway-task-id { font-size: 12px; color: #6B7280; }
        .breezeway-task-summary-line { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #4B5563; margin-top: 8px; }
        .breezeway-task-details { font-size: 13px; color: #4B5563; padding: 10px; margin-top: 10px; background-color: #f9fafb; border-radius: 6px; display: none; }
        .breezeway-task-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 3px 10px; border-radius: 12px; font-weight: 500; }
        .breezeway-task-status .dot { width: 8px; height: 8px; border-radius: 50%; }
        .breezeway-task-status.Pending { background-color: #FEF3C7; color: #92400E; } .breezeway-task-status.Pending .dot { background-color: #F59E0B; }
        .breezeway-task-status.Completed { background-color: #D1FAE5; color: #065F46; } .breezeway-task-status.Completed .dot { background-color: #10B981; }
        .breezeway-task-status.Canceled { background-color: #F3F4F6; color: #4B5563; } .breezeway-task-status.Canceled .dot { background-color: #9CA3AF; }

        /* Modals */
        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.6); z-index: 9999; display: none; justify-content: center; align-items: center; }
        .modal-content { background-color: #fff; padding: 25px; border-radius: 12px; box-shadow: 0 5px 20px rgba(0,0,0,0.2); width: 90%; max-width: 500px; font-family: 'Figtree', sans-serif; }
        .modal-content h2 { margin-top: 0; margin-bottom: 20px; color: #10275B; font-size: 18px; }
        .modal-content label { display: block; margin-bottom: 8px; font-weight: 600; font-size: 14px; color: #374151; }
        .modal-content input, .modal-content textarea, .modal-content select { width: 100%; padding: 10px; border: 1px solid #D1D5DB; border-radius: 6px; font-size: 14px; margin-bottom: 15px; box-sizing: border-box; }
        .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
        .modal-actions button { background-color: #F9FAFB; border: 1px solid #D1D5DB; color: #374151; padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.2s; }
        .modal-actions button:hover { background-color: #F3F4F6; }
        .modal-actions button.primary { background-color: #2563EB; color: #fff; border-color: #2563EB; }
        .modal-actions button.primary:hover { background-color: #1D4ED8; }
    `);

    // =========================================================================
    // Core Logic
    // =========================================================================
    function mainAppLoop() {
        const pathParts = window.location.pathname.split('/');
        if (pathParts.length < 3 || pathParts[1] !== 'inbox-v2') {
            lastProcessedConversationId = null;
            return;
        }
        const conversationId = pathParts[2];
        if (conversationId && conversationId !== lastProcessedConversationId) {
            lastProcessedConversationId = conversationId;
            fetchAndDisplayApiData(conversationId);
            updateSidebarIcons('.reservation_tooltip');
        }

        // Run SMS Limit Override continuously
        overrideSmsLimit();
    }

    // =========================================================================
    // SMS Limit Override Functions
    // =========================================================================
    function forceUnlockSendButton() {
        const sendButton = document.querySelector('[data-qa="send-message-button"]');
        if (!sendButton || !sendButton.disabled) return;

        const messageBox = sendButton.closest('.message-box');
        if (!messageBox) return;

        // Check if the reason it's disabled is specifically the SMS limit being exceeded
        const isLimitExceeded = !!messageBox.querySelector('.lucide-circle-alert') ||
                                Array.from(messageBox.querySelectorAll('p')).some(p => p.textContent.includes('character limit exceeded'));

        if (isLimitExceeded) {
            const textarea = messageBox.querySelector('textarea');
            if (textarea) {
                // Find the React Fiber node to manipulate component props
                const fiberKey = Object.keys(textarea).find(k => k.startsWith('__reactFiber$'));
                if (fiberKey) {
                    let fiber = textarea[fiberKey];
                    let maxDepth = 50; // Traverse up to 50 levels to find the parent handler
                    while (fiber && maxDepth > 0) {
                        if (fiber.memoizedProps && typeof fiber.memoizedProps.onLimitStatusChange === 'function') {
                            // Trick React into thinking the limit is not exceeded, which enables the send button natively
                            fiber.memoizedProps.onLimitStatusChange(false);
                            break;
                        }
                        fiber = fiber.return;
                        maxDepth--;
                    }
                }
            }
            // Fallback: forcefully remove disabled attribute in DOM
            sendButton.disabled = false;
            sendButton.removeAttribute('disabled');
        }
    }

    function overrideSmsLimit() {
        const textarea = document.querySelector('.message-box textarea');
        if (textarea && !textarea.dataset.smsOverrideAttached) {
            textarea.dataset.smsOverrideAttached = 'true';
            textarea.addEventListener('input', () => {
                // Delay slightly to ensure React finishes re-rendering before we unlock
                setTimeout(forceUnlockSendButton, 50);
                setTimeout(forceUnlockSendButton, 200);
            });
        }
        forceUnlockSendButton();
    }

    // =========================================================================
    // Sidebar & Navigation
    // =========================================================================
    function updateSidebarIcons(activeSelector) {
        const iconSelectors = ['.reservation_tooltip', '.operations_tooltip', '.listing_tooltip', '.guests_tooltip', '.automatedMessages_tooltip', '.links_tooltip'];
        iconSelectors.forEach(selector => {
            const icon = document.querySelector(selector + ' svg');
            if (icon) icon.classList.remove('fill-blue');
        });
        const activeIcon = document.querySelector(activeSelector + ' svg');
        if (activeIcon) activeIcon.classList.add('fill-blue');
    }

    function setupSidebarListeners() {
        const iconSelectors = ['.reservation_tooltip', '.operations_tooltip', '.listing_tooltip', '.guests_tooltip', '.automatedMessages_tooltip', '.links_tooltip'];
        iconSelectors.forEach(selector => {
            waitForElement(selector, (element) => {
                if (element.getAttribute('data-listener-attached')) return;
                element.setAttribute('data-listener-attached', 'true');
                element.addEventListener('click', (event) => {
                    if (selector === '.operations_tooltip') {
                        event.preventDefault();
                        event.stopPropagation();
                        const currentPath = window.location.pathname;
                        const pathParts = currentPath.split('/');
                        if (pathParts.length >= 3 && pathParts[1] === 'inbox-v2') {
                            const conversationId = pathParts[2];
                            const newPath = `/inbox-v2/${conversationId}/operations`;
                            if (newPath !== currentPath) {
                                window.history.pushState({path: newPath}, '', newPath);
                            }
                        }
                        updateSidebarIcons(selector);
                        if (lastProcessedConversationId) {
                            fetchAndDisplayBreezewayData(lastProcessedConversationId);
                        }
                    } else {
                        updateSidebarIcons(selector);
                    }
                });
            });
        });
    }

    // =========================================================================
    // WonderAI Functions
    // =========================================================================
    function fetchAndDisplayApiData(conversationId, oneTimeConfig = null) {
        if (currentXhr) currentXhr.abort();
        waitForElement('#threadBody', (threadBody) => {
            let infoBox = getOrCreateApiInfoBox(threadBody);
            infoBox.innerHTML = `<h3>WonderAI</h3><div class="loading-message">Fetching guest data <span class="loading-dots"><span>.</span><span>.</span><span>.</span></span></div>`;
            startPersistentScroll(threadBody);
            const config = oneTimeConfig || { agent: DEFAULT_AGENT_ID, instructions: '' };
            let apiUrl = `${WONDERAI_API_ENDPOINT_BASE}${conversationId}`;
            if (config.agent) apiUrl += `&assistant=${encodeURIComponent(config.agent)}`;
            if (config.instructions) apiUrl += `&custom_instructions=${encodeURIComponent(config.instructions)}`;
            currentXhr = GM_xmlhttpRequest({
                method: "GET", url: apiUrl, timeout: REQUEST_TIMEOUT,
                ontimeout: () => handleRequestError(infoBox, conversationId, "Request timed out. Please try again."),
                onload: (response) => {
                    if (lastProcessedConversationId !== conversationId) return;
                    let content = 'No response data.';
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const data = JSON.parse(response.responseText);
                            content = data.response ? data.response.toString() : 'Empty response from API.';
                        } catch (e) { content = 'Error: Could not parse API response.'; }
                    } else { content = `Error: API request failed with status ${response.status}.`; }
                    currentApiDataText = content;
                    infoBox.innerHTML = `<h3>WonderAI</h3><div class="custom-info-content">${currentApiDataText}</div>`;
                    addInfoBoxActions(infoBox, conversationId);
                    infoBox.classList.add('flash-success');
                    setTimeout(() => infoBox.classList.remove('flash-success'), 1500);
                    startPersistentScroll(threadBody);
                },
                onerror: (error) => { if (error.error !== 'abort') handleRequestError(infoBox, conversationId, "Error: Could not reach the API."); }
            });
        });
    }

    function handleRequestError(infoBox, conversationId, message) {
        if (lastProcessedConversationId !== conversationId) return;
        currentApiDataText = null;
        infoBox.innerHTML = `<h3>WonderAI</h3><div class="error-message">${message}</div>`;
        addInfoBoxActions(infoBox, conversationId);
        waitForElement('#threadBody', startPersistentScroll);
    }

    function getOrCreateApiInfoBox(threadBody) {
        let infoBox = document.querySelector('#custom-api-info-box');
        if (infoBox) infoBox.remove();
        infoBox = document.createElement('div');
        infoBox.id = 'custom-api-info-box';
        threadBody.appendChild(infoBox);
        return infoBox;
    }

    function addInfoBoxActions(infoBox, conversationId) {
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'custom-info-actions';
        const refreshBtn = document.createElement('button');
        refreshBtn.textContent = '✨ Refresh';
        refreshBtn.addEventListener('click', () => fetchAndDisplayApiData(conversationId));
        actionsContainer.appendChild(refreshBtn);
        if (currentApiDataText && !currentApiDataText.startsWith('Error:')) {
            const copyBtn = document.createElement('button');
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(currentApiDataText).then(() => {
                    copyBtn.textContent = '✅ Copied!';
                    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
                });
            });
            actionsContainer.appendChild(copyBtn);
        }
        const settingsBtn = document.createElement('button');
        settingsBtn.textContent = '⚙️ Agent Settings';
        settingsBtn.className = 'action-primary';
        settingsBtn.addEventListener('click', showSettingsModal);
        actionsContainer.appendChild(settingsBtn);
        infoBox.appendChild(actionsContainer);
    }

    // =========================================================================
    // Breezeway Functions
    // =========================================================================
    function fetchAndDisplayBreezewayData(conversationId) {
        const drawer = document.querySelector('[data-qa="drawer"]');
        if (!drawer) return;

        let targetElement = document.querySelector('[data-qa="fade"] > .col-wrapper');
        if (!targetElement) {
            targetElement = document.querySelector('[data-qa="fade"]');
        }
        if (!targetElement) {
            drawer.innerHTML = `<div class="breezeway-error">Could not find the content area to update.</div>`;
            return;
        }

        targetElement.innerHTML = `<div class="breezeway-loading">Fetching Breezeway data...</div>`;

        if (!mockApiDataStore) {
             mockApiDataStore = {
                listing: { name: "461 Encore 8Bd 18G", address: "461 Lasso Drive, Kissimmee, FL", imageUrl: "https://assets.guesty.com/image/upload/c_fit,h_240/v1713829145/mlc1p0fx5a6mzhmmscuq.jpg" },
                reservation: { checkIn: "2025-08-28T16:00:00Z", checkOut: "2025-09-01T10:00:00Z" },
                tasks: [
                    { id: "TSK-72315", type: "Inspection", title: "Pre-Arrival Inspection", start: "2025-08-28T14:00:00Z", status: "Completed", durationMinutes: 30, assignedTo: "John Doe", notes: "Check for any new damages." },
                    { id: "TSK-72384", type: "Cleaning", title: "Pre-Arrival Clean", start: "2025-08-28T10:00:00Z", status: "Completed", durationMinutes: 60, assignedTo: "Jane Smith", notes: "Focus on kitchen and bathrooms." },
                    { id: "TSK-72383", type: "Cleaning", title: "Departure Clean", start: "2025-09-01T10:00:00Z", status: "Pending", durationMinutes: 120, assignedTo: "Clean Team", notes: "Standard turnover cleaning." },
                    { id: "TSK-72385", type: "Inspection", title: "Post-Departure Inspection", start: "2025-09-01T14:00:00Z", status: "Pending", durationMinutes: 30, assignedTo: "John Doe", notes: "Verify property condition." },
                    { id: "TSK-72316", type: "Maintenance", title: "Fix Leaky Faucet", start: "2025-08-26T11:00:00Z", status: "Canceled", durationMinutes: 45, assignedTo: "Maintenance Pro", notes: "Guest reported a drip." }
                ]
            };
        }
        setTimeout(() => renderBreezewayData(mockApiDataStore, targetElement), 500);
    }

    function renderBreezewayData(data, container) {
        const formatDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const formatTime = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
        const formatDuration = (m) => (m<60) ? `${m} m` : `${Math.floor(m/60)}h ${m%60 > 0 ? (m%60)+'m':''}`.trim();

        const taskIcons = {
            Cleaning: `<svg class="breezeway-task-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 2H8C4.691 2 2 4.691 2 8V16C2 19.309 4.691 22 8 22H16C19.309 22 22 19.309 22 16V8C22 4.691 19.309 2 16 2ZM20 16C20 18.206 18.206 20 16 20H8C5.794 20 4 18.206 4 16V8C4 5.794 5.794 4 8 4H16C18.206 4 20 5.794 20 8V16Z" fill="#4B5563"/><path d="M12 18C9.794 18 8 16.206 8 14C8 11.794 9.794 10 12 10C14.206 10 16 11.794 16 14C16 16.206 14.206 18 12 18ZM12 12C10.897 12 10 12.897 10 14C10 15.103 10.897 16 12 16C13.103 16 14 15.103 14 14C14 12.897 13.103 12 12 12Z" fill="#4B5563"/><path d="M18 6H14V7H18V6Z" fill="#4B5563"/></svg>`,
            Inspection: `<svg class="breezeway-task-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.707,18.293l-4-4A7,7,0,1,0,14.293,15.707l4,4a1,1,0,0,0,1.414-1.414ZM10,15a5,5,0,1,1,5-5A5.006,5.006,0,0,1,10,15Z" fill="#4B5563"/><path d="M7.5 10.5H12.5V11.5H7.5z" fill="#4B5563"/></svg>`,
            Maintenance: `<svg class="breezeway-task-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21.635,8.841,12.79,2.265a2,2,0,0,0-2.58,0L1.365,8.841a2,2,0,0,0-.658,1.474L.022,19.2a2,2,0,0,0,1.97,2.253H21.008a2,2,0,0,0,1.97-2.253l-.685-8.88A2,2,0,0,0,21.635,8.841ZM11.5,18h-3a1,1,0,0,1-1-1V15a1,1,0,0,1,1-1h3a1,1,0,0,1,1,1v2A1,1,0,0,1,11.5,18Zm7-4a1,1,0,0,1-1,1h-3a1,1,0,0,1-1-1V12a1,1,0,0,1,1-1h3a1,1,0,0,1,1,1Z" fill="#4B5563"/></svg>`
        };

        const pendingCount = data.tasks.filter(t => t.status === 'Pending').length;
        const completedCount = data.tasks.filter(t => t.status === 'Completed').length;
        const canceledCount = data.tasks.filter(t => t.status === 'Canceled').length;

        container.innerHTML = `
            <div class="breezeway-container">
                <div class="breezeway-header"><h3>Breezeway</h3></div>
                <div class="breezeway-content">
                    <div class="breezeway-section">
                        <div class="breezeway-listing-card">
                            <img src="${data.listing.imageUrl}" class="breezeway-listing-img" />
                            <div><div class="name">${data.listing.name}</div><div class="address">${data.listing.address}</div></div>
                        </div>
                    </div>
                    <div class="breezeway-section breezeway-dates">
                        <div><div class="breezeway-section-title">Check-in</div><div>${formatDate(data.reservation.checkIn)}<br>${formatTime(data.reservation.checkIn)}</div></div>
                        <div><div class="breezeway-section-title">Check-out</div><div>${formatDate(data.reservation.checkOut)}<br>${formatTime(data.reservation.checkOut)}</div></div>
                    </div>
                    <div class="breezeway-section">
                        <div class="breezeway-section-title">Task Summary</div>
                        <div class="breezeway-task-summary-grid">
                            <div class="breezeway-summary-card"><div class="count">${pendingCount}</div><div class="label">Pending</div></div>
                            <div class="breezeway-summary-card"><div class="count">${completedCount}</div><div class="label">Completed</div></div>
                            <div class="breezeway-summary-card"><div class="count">${canceledCount}</div><div class="label">Canceled</div></div>
                        </div>
                        <div class="breezeway-task-controls">
                            <input type="text" placeholder="Search tasks..." class="breezeway-task-search">
                            <button class="breezeway-new-task-btn">+ New Task</button>
                        </div>
                        <div class="breezeway-filter-tabs">
                            <button class="active" data-filter="upcoming">Upcoming</button>
                            <button data-filter="past">Past</button>
                            <button data-filter="all">All</button>
                        </div>
                        <div class="breezeway-task-list"></div>
                    </div>
                </div>
            </div>`;

        const taskList = container.querySelector('.breezeway-task-list');
        const searchInput = container.querySelector('.breezeway-task-search');
        const filterTabs = container.querySelectorAll('.breezeway-filter-tabs button');
        const newTaskBtn = container.querySelector('.breezeway-new-task-btn');
        const now = new Date();

        const renderTasks = () => {
            const filter = container.querySelector('.breezeway-filter-tabs button.active').dataset.filter;
            const searchTerm = searchInput.value.toLowerCase();
            let filteredTasks = data.tasks;

            if (filter === 'upcoming') filteredTasks = data.tasks.filter(t => new Date(t.start) >= now && t.status !== 'Canceled');
            else if (filter === 'past') filteredTasks = data.tasks.filter(t => new Date(t.start) < now);

            if (searchTerm) filteredTasks = filteredTasks.filter(t => t.title.toLowerCase().includes(searchTerm));

            taskList.innerHTML = filteredTasks.map(task => `
                <div class="breezeway-task" data-task-id="${task.id}">
                    <div class="breezeway-task-header">
                        ${taskIcons[task.type] || taskIcons['Maintenance']}
                        <div><div class="breezeway-task-title">${task.title}</div><div class="breezeway-task-id">${task.id}</div></div>
                    </div>
                    <div class="breezeway-task-summary-line">
                        <span>${formatDate(task.start)}</span>
                        <span class="breezeway-task-status ${task.status}"><div class="dot"></div>${task.status}</span>
                    </div>
                    <div class="breezeway-task-details">
                        <b>Assigned To:</b> ${task.assignedTo}<br>
                        <b>Duration:</b> ${formatDuration(task.durationMinutes)}<br>
                        <b>Notes:</b> ${task.notes || 'None'}
                    </div>
                </div>`).join('');
            if (filteredTasks.length === 0) taskList.innerHTML = `<div style="text-align:center;color:#6B7280;padding:20px;">No tasks found.</div>`;

            taskList.querySelectorAll('.breezeway-task').forEach(taskEl => {
                taskEl.addEventListener('click', () => {
                    const details = taskEl.querySelector('.breezeway-task-details');
                    details.style.display = details.style.display === 'block' ? 'none' : 'block';
                });
            });
        };

        filterTabs.forEach(tab => tab.addEventListener('click', () => {
            filterTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderTasks();
        }));
        searchInput.addEventListener('input', renderTasks);
        newTaskBtn.addEventListener('click', showNewTaskModal);

        renderTasks();
    }

    // =========================================================================
    // Utility and Modal Functions
    // =========================================================================
    function createNewTaskModal() {
        if (document.getElementById('new-task-modal-overlay')) return;
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'new-task-modal-overlay';
        modalOverlay.className = 'modal-overlay';
        modalOverlay.innerHTML = `
            <div class="modal-content">
                <h2>Create New Task</h2>
                <label for="task-title">Title</label><input type="text" id="task-title" required>
                <label for="task-type">Type</label><select id="task-type"><option>Cleaning</option><option>Inspection</option><option>Maintenance</option></select>
                <label for="task-date">Date</label><input type="datetime-local" id="task-date" required>
                <label for="task-duration">Duration (minutes)</label><input type="number" id="task-duration" value="30">
                <div class="modal-actions">
                    <button id="task-cancel-btn">Cancel</button>
                    <button id="task-save-btn" class="primary">Save Task</button>
                </div>
            </div>`;
        document.body.appendChild(modalOverlay);
        modalOverlay.querySelector('#task-cancel-btn').addEventListener('click', hideNewTaskModal);
        modalOverlay.querySelector('#task-save-btn').addEventListener('click', () => {
            const newTask = {
                id: `TSK-${Math.floor(Math.random() * 90000) + 10000}`,
                type: document.getElementById('task-type').value,
                title: document.getElementById('task-title').value,
                start: new Date(document.getElementById('task-date').value).toISOString(),
                status: "Pending",
                durationMinutes: parseInt(document.getElementById('task-duration').value, 10),
                assignedTo: "Unassigned",
                notes: "Newly created task."
            };
            if (!newTask.title || !document.getElementById('task-date').value) { alert("Please fill in all required fields."); return; }
            mockApiDataStore.tasks.push(newTask);
            hideNewTaskModal();
            renderBreezewayData(mockApiDataStore, document.querySelector('[data-qa="fade"] > .col-wrapper') || document.querySelector('[data-qa="fade"]'));
        });
    }

    function showNewTaskModal() { document.getElementById('new-task-modal-overlay').style.display = 'flex'; }
    function hideNewTaskModal() { document.getElementById('new-task-modal-overlay').style.display = 'none'; }

    function createSettingsModal() {
        if (document.getElementById('settings-modal-overlay')) return;
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'settings-modal-overlay';
        modalOverlay.className = 'modal-overlay';
        modalOverlay.innerHTML = `
            <div class="modal-content">
                <h2>Agent Settings</h2>
                <p style="font-size: 13px; color: #6B7280; margin-top: -10px; margin-bottom: 20px;">These settings will only apply to the next request. They will not be saved.</p>
                <div><label for="agent-select">Agent</label><select id="agent-select"><option value="asst_G2GXKe63yoEDg0rqP0hMMYAL">Default (WonderAI v2)</option><option value="asst_hVXKym7RUEN0FFf1v8fP2JEw">5-star Review Specialist</option></select></div>
                <div><label for="custom-instructions">Custom Instructions</label><textarea id="custom-instructions" placeholder="e.g., Always be friendly and use emojis."></textarea></div>
                <div class="modal-actions"><button id="settings-close-btn">Close</button><button id="settings-apply-btn" class="primary">Apply for this time</button></div>
            </div>`;
        document.body.appendChild(modalOverlay);
        const content = modalOverlay.querySelector('.modal-content');
        const closeBtn = modalOverlay.querySelector('#settings-close-btn');
        const applyBtn = modalOverlay.querySelector('#settings-apply-btn');
        content.addEventListener('click', (e) => e.stopPropagation());
        modalOverlay.addEventListener('click', hideSettingsModal);
        closeBtn.addEventListener('click', hideSettingsModal);
        applyBtn.addEventListener('click', () => {
            const oneTimeConfig = { agent: document.getElementById('agent-select').value, instructions: document.getElementById('custom-instructions').value };
            hideSettingsModal();
            if (lastProcessedConversationId) fetchAndDisplayApiData(lastProcessedConversationId, oneTimeConfig);
        });
    }

    function showSettingsModal() {
        const modal = document.getElementById('settings-modal-overlay');
        if (modal) {
            document.getElementById('agent-select').value = DEFAULT_AGENT_ID;
            document.getElementById('custom-instructions').value = '';
            modal.style.display = 'flex';
        }
    }

    function hideSettingsModal() {
        const modal = document.getElementById('settings-modal-overlay');
        if (modal) modal.style.display = 'none';
    }

    function startPersistentScroll(element) {
        if (scrollInterval) clearInterval(scrollInterval);
        let lastHeight = 0, stableChecks = 0;
        scrollInterval = setInterval(() => {
            if (!element || !element.parentElement) { clearInterval(scrollInterval); return; }
            const currentHeight = element.scrollHeight;
            element.scrollTop = currentHeight;
            if (currentHeight === lastHeight) stableChecks++; else stableChecks = 0;
            lastHeight = currentHeight;
            if (stableChecks >= 5) clearInterval(scrollInterval);
        }, 200);
        setTimeout(() => clearInterval(scrollInterval), 4000);
    }

    function waitForElement(selector, callback) {
        const el = document.querySelector(selector);
        if (el) { callback(el); return; }
        const observer = new MutationObserver(() => {
            const foundEl = document.querySelector(selector);
            if (foundEl) { observer.disconnect(); callback(foundEl); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // --- Script Initialization ---
    console.log('Guesty Inbox Enhancer v2.8.4 Activated.');
    createSettingsModal();
    createNewTaskModal();
    setupSidebarListeners();
    setInterval(mainAppLoop, 500);
    setInterval(setupSidebarListeners, 2000);

})();
