// ==UserScript==
// @name         SysAid Activity Quick Time Buttons
// @namespace    https://github.com/Rhigo/SysAid-Activity-Quick-Time-Buttons
// @version      0.5
// @description  Adds quick duration buttons to SysAid Activity entries and auto-fills End Time using the existing Start Time.
// @author       Rhigo
// @match        https://*/spaces/ticket*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /*
     * ============================================================
     * EASY SETTINGS
     * ============================================================
     */

    /*
     * Quick buttons shown in the activity editor.
     * These are in minutes.
     *
     * Example:
     * 15  = 15 minutes
     * 60  = 1 hour
     * 120 = 2 hours
     */
    const QUICK_MINUTES = [15, 30, 45, 60, 75, 90, 105, 120];

    /*
     * Button colours.
     *
     * Change these if you want the buttons to match your own branding.
     */
    const BUTTON_COLOURS = {
        background: '#fe6c43',
        border: '#fe6c43',
        text: '#ffffff',
        hoverBackground: '#ff805f',
        hoverShadow: 'rgba(254, 108, 67, 0.25)'
    };

    /*
     * Panel colours.
     */
    const PANEL_COLOURS = {
        background: '#f8fafc',
        border: '#d8dee8',
        title: '#0f2530',
        text: '#344868',
        mutedText: '#7d899d',
        inputBackground: '#ffffff',
        inputBorder: '#cfd7e3'
    };

    const SETTINGS = {
        debug: false,

        /*
         * This script deliberately does NOT overwrite an existing End Time.
         *
         * Reason:
         * SysAid/MUI changes the End Time picker structure after a value is already set.
         * That makes re-clicking another duration unreliable.
         *
         * Safer behaviour:
         * - Pick a duration once
         * - If you need to change it, manually clear/edit the End Time or reopen the Activity editor
         */
        allowOverwriteExistingEndTime: false,

        /*
         * Optional: append "Time spent: X minutes" into the Description box.
         */
        appendDescriptionNote: false
    };

    /*
     * ============================================================
     * INTERNAL SCRIPT LOGIC
     * ============================================================
     */

    let isApplyingDuration = false;

    function log(...args) {
        if (SETTINGS.debug) {
            console.log('[SysAid Quick Activity]', ...args);
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    function normaliseText(text) {
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function nativeSetValue(element, value) {
        if (!element) return false;

        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else if (valueSetter) {
            valueSetter.call(element, value);
        } else {
            element.value = value;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));

        return true;
    }

    function muiClick(element) {
        if (!element) return false;

        try {
            element.scrollIntoView({ block: 'center', inline: 'center' });
        } catch (_) {}

        element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
        element.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, pointerType: 'mouse' }));
        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        element.click();

        return true;
    }

    function parseSysAidDateTime(value) {
        const match = String(value || '').trim().match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/);
        if (!match) return null;

        const [, dd, mm, yyyy, hh, min] = match;

        return new Date(
            Number(yyyy),
            Number(mm) - 1,
            Number(dd),
            Number(hh),
            Number(min),
            0,
            0
        );
    }

    function formatSysAidDateTime(date) {
        return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function formatDurationLabel(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;

        let label = '';
        if (hours > 0) label += `${hours}h `;
        if (mins > 0) label += `${mins}m`;
        if (!label.trim()) label = '0m';

        return label.trim();
    }

    function findActivityPanels() {
        return [...document.querySelectorAll('.action-line')]
            .filter(panel => {
                const text = panel.innerText || '';

                return text.includes('Activity') &&
                    text.includes('Start Time') &&
                    text.includes('End Time') &&
                    panel.querySelector('[data-testid="action-line-save-button"], [data-cy="action-line-save-button"]');
            });
    }

    function findStartInput(panel) {
        const inputs = [...panel.querySelectorAll('input[type="text"]')];

        return inputs.find(input => parseSysAidDateTime(input.value));
    }

    function getDateTimeStringsFromPanel(panel) {
        const dateTimeRegex = /\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}/g;
        const found = new Set();

        const panelTextMatches = String(panel.innerText || '').match(dateTimeRegex) || [];
        panelTextMatches.forEach(value => found.add(value));

        const inputs = [...panel.querySelectorAll('input')];
        inputs.forEach(input => {
            const inputMatches = String(input.value || '').match(dateTimeRegex) || [];
            inputMatches.forEach(value => found.add(value));
        });

        return [...found];
    }

    function hasExistingEndTime(panel) {
        const startInput = findStartInput(panel);
        const startValue = startInput?.value;

        if (!startValue) return false;

        const dateTimeValues = getDateTimeStringsFromPanel(panel);

        /*
         * If we can see another date/time value that is not the Start Time,
         * assume End Time is already populated.
         */
        return dateTimeValues.some(value => value !== startValue);
    }

    function findEndButton(panel) {
        /*
         * Safe supported state:
         * End Time is empty.
         *
         * SysAid usually shows:
         * data-testid="empty-date-picker"
         */
        const emptyPicker = panel.querySelector('[data-testid="empty-date-picker"]');

        if (emptyPicker) {
            log('End picker target: empty-date-picker button');
            return emptyPicker;
        }

        /*
         * Deliberately do not attempt to click the populated End Time field.
         * That was the unreliable bit.
         */
        log('End picker target not found. End Time may already be populated.');
        return null;
    }

    function findSubmitButton(panel) {
        return panel.querySelector('[data-testid="action-line-save-button"], [data-cy="action-line-save-button"]');
    }

    function findDescriptionBox(panel) {
        return panel.querySelector('textarea[placeholder*="description"], textarea');
    }

    function setTotalTimeVisual(panel, minutes) {
        const totalText = panel.querySelector('.text-dueDateField');

        if (!totalText) {
            const totalField = [...panel.querySelectorAll('div, span, button')]
                .find(el => normaliseText(el.innerText || '').includes('Time will be auto-filled'));

            if (totalField) {
                totalField.textContent = ` ${formatDurationLabel(minutes)} selected `;
            }

            return;
        }

        totalText.textContent = ` ${formatDurationLabel(minutes)} selected `;
    }

    function appendDescription(panel, minutes) {
        if (!SETTINGS.appendDescriptionNote) return;

        const textarea = findDescriptionBox(panel);
        if (!textarea) return;

        const note = `Time spent: ${minutes} minutes`;

        const cleaned = textarea.value
            .split('\n')
            .filter(line => !line.trim().startsWith('Time spent:'))
            .join('\n')
            .trim();

        const newValue = cleaned
            ? `${cleaned}\n${note}`
            : note;

        nativeSetValue(textarea, newValue);
    }

    function markQuickPanelAsApplied(panel, minutes, formattedEnd) {
        const quickPanel = panel.querySelector('.gt-sysaid-quick-activity');
        if (!quickPanel) return;

        quickPanel.classList.add('gt-applied');
        quickPanel.dataset.applied = 'true';

        quickPanel.querySelectorAll('button, input').forEach(element => {
            element.disabled = true;
        });

        const status = quickPanel.querySelector('.gt-status');
        if (status) {
            status.textContent = `Applied ${formatDurationLabel(minutes)}. End Time set to ${formattedEnd}.`;
        }

        const help = quickPanel.querySelector('.gt-help');
        if (help) {
            help.textContent = 'Duration has been applied. To change it, manually edit or clear the End Time in SysAid, then reopen the Activity editor.';
        }
    }

    function getOpenPicker() {
        return document.querySelector(
            '.MuiPopover-paper, .MuiDialog-paper, .MuiPickersPopper-root, [role="dialog"]'
        );
    }

    async function closeAnyOpenPicker() {
        const picker = getOpenPicker();
        if (!picker) return;

        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            bubbles: true
        }));

        document.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'Escape',
            code: 'Escape',
            bubbles: true
        }));

        await sleep(250);
    }

    function clickButtonByText(container, wantedText) {
        const wanted = String(wantedText);

        const candidates = [
            ...container.querySelectorAll('button, [role="button"], [role="gridcell"]')
        ];

        const exact = candidates.find(el => normaliseText(el.innerText) === wanted);

        if (exact) {
            muiClick(exact);
            return true;
        }

        return false;
    }

    async function selectCalendarDate(targetDate) {
        const picker = getOpenPicker();
        if (!picker) return false;

        const day = String(targetDate.getDate());

        const dayButtons = [
            ...picker.querySelectorAll('button, [role="gridcell"]')
        ].filter(el => {
            const text = normaliseText(el.innerText);
            const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';

            return text === day && !disabled;
        });

        if (dayButtons.length) {
            muiClick(dayButtons[0]);
            log('Selected date day:', day);
            await sleep(150);
            return true;
        }

        log('Could not find calendar day button. It may already be selected.');
        return false;
    }

    function getScrollablePickerColumns() {
        const picker = getOpenPicker();
        if (!picker) return [];

        const elements = [...picker.querySelectorAll('*')];

        const scrollables = elements.filter(el => {
            const style = window.getComputedStyle(el);
            const canScroll = el.scrollHeight > el.clientHeight + 10;
            const overflowY = style.overflowY;

            return canScroll && ['auto', 'scroll', 'hidden'].includes(overflowY);
        });

        return scrollables.filter(el => {
            const rect = el.getBoundingClientRect();

            return rect.height > 80 &&
                rect.height < 450 &&
                rect.width > 25 &&
                rect.width < 160;
        });
    }

    async function findAndClickInScrollableColumn(column, value) {
        const wanted = pad(value);
        const wantedUnpadded = String(Number(value));

        async function tryVisibleClick() {
            const candidates = [
                ...column.querySelectorAll('li, button, div, span, [role="option"]')
            ];

            const match = candidates.find(el => {
                const text = normaliseText(el.innerText);
                if (!text) return false;

                return text === wanted || text === wantedUnpadded;
            });

            if (match) {
                match.scrollIntoView({ block: 'center' });
                await sleep(80);
                muiClick(match);
                return true;
            }

            return false;
        }

        if (await tryVisibleClick()) return true;

        const maxScroll = column.scrollHeight - column.clientHeight;
        const steps = 50;

        for (let i = 0; i <= steps; i++) {
            column.scrollTop = (maxScroll / steps) * i;
            column.dispatchEvent(new Event('scroll', { bubbles: true }));
            await sleep(25);

            if (await tryVisibleClick()) return true;
        }

        return false;
    }

    async function selectTimeInPicker(targetDate) {
        const targetHour = targetDate.getHours();
        const targetMinute = targetDate.getMinutes();

        await sleep(250);

        let columns = getScrollablePickerColumns();

        log('Found picker scroll columns:', columns.length);

        if (columns.length < 2) {
            const picker = getOpenPicker();
            if (!picker) return false;

            const hourClicked =
                clickButtonByText(picker, pad(targetHour)) ||
                clickButtonByText(picker, String(targetHour));

            await sleep(150);

            const minuteClicked =
                clickButtonByText(picker, pad(targetMinute)) ||
                clickButtonByText(picker, String(targetMinute));

            log('Fallback visible click:', {
                hourClicked,
                minuteClicked
            });

            return hourClicked && minuteClicked;
        }

        columns = columns
            .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
            .slice(-2);

        const hourColumn = columns[0];
        const minuteColumn = columns[1];

        const hourOK = await findAndClickInScrollableColumn(hourColumn, targetHour);
        await sleep(150);

        const minuteOK = await findAndClickInScrollableColumn(minuteColumn, targetMinute);
        await sleep(150);

        log('Selected time:', {
            hour: targetHour,
            minute: targetMinute,
            hourOK,
            minuteOK
        });

        return hourOK && minuteOK;
    }

    async function savePicker() {
        const picker = getOpenPicker();
        if (!picker) return false;

        const buttons = [...picker.querySelectorAll('button')];

        const saveButton = buttons.find(button => {
            const text = normaliseText(button.innerText).toLowerCase();
            return ['save', 'ok', 'apply', 'done'].includes(text);
        });

        if (!saveButton) {
            log('Could not find picker Save/OK button.');
            return false;
        }

        muiClick(saveButton);
        await sleep(500);

        return true;
    }

    async function openPickerFromTarget(target) {
        if (!target) return false;

        const attempts = [];

        attempts.push(target);

        const parentClickable = target.closest('button, [role="button"], .MuiButtonBase-root, .MuiInputBase-root');
        if (parentClickable && !attempts.includes(parentClickable)) attempts.push(parentClickable);

        let parent = target.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
            if (!attempts.includes(parent)) attempts.push(parent);
            parent = parent.parentElement;
        }

        for (const attempt of attempts) {
            log('Trying to open picker by clicking:', {
                tag: attempt.tagName,
                className: attempt.className,
                text: normaliseText(attempt.innerText || attempt.value || '').slice(0, 80)
            });

            muiClick(attempt);
            await sleep(450);

            if (getOpenPicker()) {
                log('Picker opened successfully.');
                return true;
            }
        }

        return false;
    }

    async function setEndTimeViaMuiPicker(panel, targetDate) {
        await closeAnyOpenPicker();

        const endButton = findEndButton(panel);

        if (!endButton) {
            log('No empty End Time picker button found.');
            return false;
        }

        const opened = await openPickerFromTarget(endButton);

        if (!opened) {
            log('End Time picker did not open.');
            return false;
        }

        await selectCalendarDate(targetDate);
        await selectTimeInPicker(targetDate);

        const saved = await savePicker();

        log('Picker save clicked:', saved);

        return saved;
    }

    async function applyDuration(panel, minutes) {
        if (isApplyingDuration) {
            log('Already applying a duration. Ignoring additional click.');
            return;
        }

        isApplyingDuration = true;

        try {
            await doApplyDuration(panel, minutes);
        } finally {
            isApplyingDuration = false;
        }
    }

    async function doApplyDuration(panel, minutes) {
        const startInput = findStartInput(panel);

        if (!startInput) {
            alert('Could not find the SysAid Start Time input. Open the Activity editor first.');
            return;
        }

        const startDate = parseSysAidDateTime(startInput.value);

        if (!startDate || Number.isNaN(startDate.getTime())) {
            alert(`Could not parse Start Time: "${startInput.value}"`);
            return;
        }

        if (!SETTINGS.allowOverwriteExistingEndTime && hasExistingEndTime(panel)) {
            alert('End Time already has a value. To change the duration, manually edit or clear End Time in SysAid, then reopen the Activity editor.');
            return;
        }

        const endDate = new Date(startDate.getTime() + minutes * 60 * 1000);
        const formattedEnd = formatSysAidDateTime(endDate);

        log('Start:', startInput.value);
        log('Minutes:', minutes);
        log('End:', formattedEnd);

        setTotalTimeVisual(panel, minutes);
        appendDescription(panel, minutes);

        const applied = await setEndTimeViaMuiPicker(panel, endDate);
        await sleep(700);

        if (applied) {
            markQuickPanelAsApplied(panel, minutes, formattedEnd);
        } else {
            alert('Could not set the End Time automatically. SysAid may have changed the Activity editor layout.');
            return;
        }

        const submitButton = findSubmitButton(panel);

        if (submitButton && submitButton.disabled) {
            log('Submit is still disabled. SysAid may not have accepted the picker state.');
        } else {
            log('Submit appears enabled.');
        }
    }

    function createQuickPanel(panel) {
        if (panel.querySelector('.gt-sysaid-quick-activity')) return;

        const quickPanel = document.createElement('div');
        quickPanel.className = 'gt-sysaid-quick-activity';

        quickPanel.innerHTML = `
            <div class="gt-title">Quick Activity Time</div>

            <div class="gt-button-grid">
                ${QUICK_MINUTES.map(min => `
                    <button type="button" class="gt-time-btn" data-minutes="${min}">
                        ${min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`}
                    </button>
                `).join('')}
            </div>

            <div class="gt-custom-row">
                <label>
                    Hours
                    <input type="number" class="gt-hours" min="0" max="24" value="0">
                </label>

                <label>
                    Minutes
                    <input type="number" class="gt-minutes" min="0" max="59" value="20">
                </label>

                <button type="button" class="gt-apply-custom">Apply</button>
            </div>

            <div class="gt-status"></div>

            <div class="gt-help">
                Uses the existing Start Time and calculates the End Time automatically. This will only apply when End Time is empty.
            </div>
        `;

        quickPanel.querySelectorAll('.gt-time-btn').forEach(button => {
            button.addEventListener('click', () => {
                const minutes = Number(button.dataset.minutes);
                applyDuration(panel, minutes);
            });
        });

        quickPanel.querySelector('.gt-apply-custom').addEventListener('click', () => {
            const hours = Number(quickPanel.querySelector('.gt-hours').value || 0);
            const minutes = Number(quickPanel.querySelector('.gt-minutes').value || 0);

            const totalMinutes = (hours * 60) + minutes;

            if (!totalMinutes || totalMinutes < 1) {
                alert('Enter a duration greater than 0 minutes.');
                return;
            }

            applyDuration(panel, totalMinutes);
        });

        const descriptionLabel = [...panel.querySelectorAll('div')]
            .find(div => (div.innerText || '').trim() === 'Description');

        const descriptionContainer = descriptionLabel?.closest('.MuiBox-root');

        if (descriptionContainer && descriptionContainer.parentElement) {
            descriptionContainer.parentElement.insertBefore(quickPanel, descriptionContainer);
        } else {
            panel.appendChild(quickPanel);
        }

        log('Injected quick activity panel.');
    }

    function injectStyles() {
        if (document.querySelector('#gt-sysaid-quick-activity-styles')) return;

        const style = document.createElement('style');
        style.id = 'gt-sysaid-quick-activity-styles';

        style.textContent = `
            .gt-sysaid-quick-activity {
                margin: 14px 0;
                padding: 14px;
                border: 1px solid ${PANEL_COLOURS.border};
                border-radius: 12px;
                background: ${PANEL_COLOURS.background};
                box-shadow: 0 2px 8px rgba(15, 37, 48, 0.08);
                font-family: Figtree, Arial, sans-serif;
            }

            .gt-sysaid-quick-activity .gt-title {
                font-size: 14px;
                font-weight: 700;
                color: ${PANEL_COLOURS.title};
                margin-bottom: 10px;
            }

            .gt-sysaid-quick-activity .gt-button-grid {
                display: grid;
                grid-template-columns: repeat(4, minmax(70px, 1fr));
                gap: 8px;
                margin-bottom: 12px;
            }

            .gt-sysaid-quick-activity .gt-time-btn,
            .gt-sysaid-quick-activity .gt-apply-custom {
                border: 1px solid ${BUTTON_COLOURS.border};
                background: ${BUTTON_COLOURS.background};
                color: ${BUTTON_COLOURS.text};
                border-radius: 999px;
                padding: 8px 10px;
                cursor: pointer;
                font-weight: 700;
                font-size: 13px;
                transition: transform 0.1s ease, opacity 0.1s ease, box-shadow 0.1s ease, background 0.1s ease;
            }

            .gt-sysaid-quick-activity .gt-time-btn:hover,
            .gt-sysaid-quick-activity .gt-apply-custom:hover {
                background: ${BUTTON_COLOURS.hoverBackground};
                opacity: 0.96;
                transform: translateY(-1px);
                box-shadow: 0 3px 8px ${BUTTON_COLOURS.hoverShadow};
            }

            .gt-sysaid-quick-activity .gt-time-btn:active,
            .gt-sysaid-quick-activity .gt-apply-custom:active {
                transform: translateY(0);
                box-shadow: none;
            }

            .gt-sysaid-quick-activity .gt-time-btn:disabled,
            .gt-sysaid-quick-activity .gt-apply-custom:disabled,
            .gt-sysaid-quick-activity input:disabled {
                opacity: 0.55;
                cursor: not-allowed;
                transform: none;
                box-shadow: none;
            }

            .gt-sysaid-quick-activity .gt-custom-row {
                display: flex;
                align-items: end;
                gap: 10px;
                flex-wrap: wrap;
            }

            .gt-sysaid-quick-activity label {
                display: flex;
                flex-direction: column;
                gap: 4px;
                font-size: 12px;
                color: ${PANEL_COLOURS.text};
                font-weight: 700;
            }

            .gt-sysaid-quick-activity input {
                width: 80px;
                border: 1px solid ${PANEL_COLOURS.inputBorder};
                border-radius: 8px;
                padding: 7px 8px;
                font-size: 13px;
                background: ${PANEL_COLOURS.inputBackground};
                color: ${PANEL_COLOURS.title};
            }

            .gt-sysaid-quick-activity .gt-status {
                margin-top: 8px;
                color: ${PANEL_COLOURS.title};
                font-size: 12px;
                font-weight: 700;
            }

            .gt-sysaid-quick-activity .gt-help {
                margin-top: 8px;
                color: ${PANEL_COLOURS.mutedText};
                font-size: 12px;
            }

            .gt-sysaid-quick-activity.gt-applied {
                border-style: solid;
            }
        `;

        document.head.appendChild(style);
    }

    function scanAndInject() {
        injectStyles();

        const panels = findActivityPanels();

        panels.forEach(createQuickPanel);
    }

    const observer = new MutationObserver(() => {
        scanAndInject();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    scanAndInject();

})();
