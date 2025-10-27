// ==UserScript==
// @name         PTAPlanning Extractor
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Extracts schedule data from PTAPlanning, converts to ICS, and updates a local file incrementally without removing existing entries.
// @author       You
// @match        https://pleiades.gha.kfplc.com/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(() => {
    const INIT_GUARD_KEY = "__ptaSyncInitialised";
    const SYNC_BUTTON_ID = "pta-sync-schedule-button";
    const SYNC_BUTTON_STYLE_ID = "pta-sync-button-style";

    if (window.top !== window.self) {
        return;
    }

    if (window[INIT_GUARD_KEY]) {
        return;
    }

    window[INIT_GUARD_KEY] = true;

    function injectSyncButtonStyles() {
        if (document.getElementById(SYNC_BUTTON_STYLE_ID)) {
            return;
        }

        const style = document.createElement("style");
        style.id = SYNC_BUTTON_STYLE_ID;
        style.textContent = `
        .pta-sync-button-wrapper {
            display: inline-flex;
            gap: 0.5rem;
            align-items: center;
            font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        }

        body > .pta-sync-button-wrapper {
            position: fixed;
            top: 1.5rem;
            right: 1.5rem;
            z-index: 1000;
        }

        #${SYNC_BUTTON_ID} {
            background: linear-gradient(180deg, #59a5ff 0%, #1b6dd8 100%);
            border: 1px solid #1452a1;
            border-radius: 20px;
            color: #fff;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            padding: 0.6rem 1.4rem;
            box-shadow: 0 6px 18px rgba(23, 92, 197, 0.35);
            transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease;
        }

        #${SYNC_BUTTON_ID}:hover {
            transform: translateY(-1px);
            box-shadow: 0 10px 24px rgba(23, 92, 197, 0.45);
            background: linear-gradient(180deg, #64adff 0%, #2c7deb 100%);
        }

        #${SYNC_BUTTON_ID}:active {
            transform: translateY(1px);
            box-shadow: 0 4px 12px rgba(14, 60, 130, 0.4);
        }

        #${SYNC_BUTTON_ID}[data-busy="true"] {
            cursor: wait;
            opacity: 0.75;
            pointer-events: none;
        }

        .pta-sync-status {
            color: #0b3d91;
            font-size: 13px;
            background: rgba(255, 255, 255, 0.85);
            padding: 0.4rem 0.8rem;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
        }

        .pta-sync-status[data-variant="success"] {
            color: #0f7a2d;
        }

        .pta-sync-status[data-variant="error"] {
            color: #b2001d;
        }
    `;

        document.head.appendChild(style);
    }

    function createSyncButtonContainer() {
        const wrapper = document.createElement("div");
        wrapper.className = "pta-sync-button-wrapper";

        const button = document.createElement("button");
        button.id = SYNC_BUTTON_ID;
        button.type = "button";
        button.textContent = "Sync Schedule";

        const status = document.createElement("span");
        status.className = "pta-sync-status";
        status.hidden = true;

        wrapper.appendChild(button);
        wrapper.appendChild(status);

        return { wrapper, button, status };
    }

    function insertSyncButton(onClick) {
        injectSyncButtonStyles();

        const existing = document.getElementById(SYNC_BUTTON_ID);
        if (existing) {
            return {
                button: existing,
                status: existing.nextElementSibling instanceof HTMLElement ? existing.nextElementSibling : null
            };
        }

        const { wrapper, button, status } = createSyncButtonContainer();
        button.addEventListener("click", () => onClick({ button, status }));

        const preferredTargets = [
            "#zoneMenuDroite",
            "#zoneDroiteEntete",
            "#enteteDroite",
            "header .entete-droite",
            "#EnteteDroite",
            "#Entete",
            "body"
        ];

        let host = document.body;
        for (const selector of preferredTargets) {
            const candidate = document.querySelector(selector);
            if (candidate) {
                host = candidate;
                break;
            }
        }

        if (host === document.body) {
            document.body.appendChild(wrapper);
        } else {
            host.appendChild(wrapper);
        }

        return { button, status };
    }

    function setSyncStatus(ui, message, variant = "info") {
        if (!ui || !ui.status) return;

        ui.status.textContent = message;
        ui.status.hidden = !message;
        ui.status.dataset.variant = variant;
    }

    async function fetchICSFromGitHub() {
        const url = "https://api.github.com/repos/ArildWaldan/pleiadessync/contents/test.ics";
        const token = "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";

        try {
            const response = await fetch(url, {
                headers: {
                    Authorization: `token ${token}`,
                    Accept: "application/vnd.github.v3+json"
                }
            });

            if (!response.ok) {
                console.error("Failed to fetch existing ICS from GitHub:", await response.json());
                return null;
            }

            const fileData = await response.json();
            const content = atob(fileData.content);
            console.log("Fetched ICS from GitHub:", content);
            return { content, sha: fileData.sha }; // Return both content and SHA for updates
        } catch (error) {
            console.error("Error fetching ICS from GitHub:", error);
            return null;
        }
    }

    async function fetchSchedulePage() {
        return fetch("https://pleiades.gha.kfplc.com/pta/pages/planning/PTAPlanningIndividuel.jsp", {
            method: "GET",
            headers: {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            }
        }).then(response => response.text());
    }

    function parseSchedule(htmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");

        const today = new Date();
        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + 30);

        const tdElements = Array.from(doc.querySelectorAll("td[id]"));
        const scheduleData = [];

        tdElements.forEach(td => {
            const id = td.getAttribute("id");
            const dateMatch = id && id.match(/^\d{4}\d{2}\d{2}-/);
            if (!dateMatch) return;

            const year = id.substring(0, 4);
            const month = id.substring(4, 6);
            const day = id.substring(6, 8);
            const cellDate = new Date(year, month - 1, day);

            // skip if date is out of desired range
            if (cellDate < today || cellDate > endDate) return;

            const cellText = td.textContent.trim();
            // Add CP to your "no-work" conditions
            if (["REPOS", "JF", "CP", ""].includes(cellText.toUpperCase())) {
                scheduleData.push({
                    date: `${year}-${month}-${day}`,
                    shifts: [],
                    mergedEvent: { dayHasWork: false }
                });
                return;
            }

            let shifts = [];
            // If there's an inner table, gather times from .present cells
            const innerTable = td.querySelector(".innerTable");
            if (innerTable) {
                const shiftCells = Array.from(innerTable.querySelectorAll("td.present"));
                shiftCells.forEach(sCell => {
                    const times = sCell.textContent.trim().split(" ");
                    if (times.length === 2) {
                        shifts.push({ start: times[0], end: times[1] });
                    }
                });
            } else {
                // otherwise, parse the text content directly
                const times = cellText.replace("<br>", "").trim().split(" ");
                if (times.length === 2) {
                    shifts.push({ start: times[0], end: times[1] });
                }
            }

            // if no valid shifts found, mark day as no-work
            if (shifts.length === 0) {
                scheduleData.push({
                    date: `${year}-${month}-${day}`,
                    shifts: [],
                    mergedEvent: { dayHasWork: false }
                });
                return;
            }

            // merge multiple shifts into a single summary
            const sortedShifts = shifts.slice().sort((a, b) => a.start.localeCompare(b.start));
            const earliestStart = sortedShifts[0].start;
            const latestEnd = sortedShifts[sortedShifts.length - 1].end;
            const mergedTitle = sortedShifts.map(s => `${s.start} - ${s.end}`).join(" / ");

            scheduleData.push({
                date: `${year}-${month}-${day}`,
                shifts,
                mergedEvent: {
                    start: earliestStart,
                    end: latestEnd,
                    title: mergedTitle,
                    dayHasWork: true
                }
            });
        });

        return scheduleData;
    }


    function mergeAndUpdateICS(newData, existingICS) {
        // Parse out existing events just as you do now
        const existingEvents = existingICS.match(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g) || [];
        const eventMap = new Map();

        existingEvents.forEach(event => {
            const uidMatch = event.match(/UID:(.+?)\r\n/);
            if (uidMatch) {
                eventMap.set(uidMatch[1], event + "\r\n");
                // Ensure there's a trailing newline
                // (so we don't concatenate events on the same line)
            }
        });

        newData.forEach(entry => {
            if (!entry.mergedEvent.dayHasWork) return;

            // Validate or parse the times (skip if nonsense)
            if (!/^\d{2}:\d{2}$/.test(entry.mergedEvent.start) || !/^\d{2}:\d{2}$/.test(entry.mergedEvent.end)) {
                // e.g., skip if you get "Dim." or "Mer." etc.
                return;
            }

            const uid = `uid-${entry.date}@example.com`;
            const dtstamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
            const startDT = `${entry.date.replace(/-/g, "")}T${entry.mergedEvent.start.replace(":", "")}00`;
            const endDT = `${entry.date.replace(/-/g, "")}T${entry.mergedEvent.end.replace(":", "")}00`;

            // Build each VEVENT carefully, ensuring correct newlines
            const eventLines = [
                "BEGIN:VEVENT",
                `UID:${uid}`,
                `DTSTAMP:${dtstamp}`,
                `DTSTART:${startDT}`,
                `DTEND:${endDT}`,
                `SUMMARY:${entry.mergedEvent.title}`,
                "END:VEVENT",
                "" // blank line so the next BEGIN:VEVENT starts on a new line
            ];
            const eventString = eventLines.join("\r\n");

            eventMap.set(uid, eventString);
        });

        // Rebuild ICS with clean line breaks
        let updatedICS = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//YourOrg//PTAExtractor 1.0//EN",
            `COMMENT:Last update on ${new Date().toISOString()}`
        ].join("\r\n") + "\r\n";

        eventMap.forEach(event => {
            updatedICS += event;
        });

        updatedICS += "END:VCALENDAR\r\n";

        return updatedICS;
    }


    async function commitToGitHub(content, sha) {
        const url = "https://api.github.com/repos/ArildWaldan/pleiadessync/contents/test.ics";
        const token = "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";

        try {
            const payload = {
                message: "Update ICS schedule",
                content: btoa(unescape(encodeURIComponent(content))),
                branch: "main",
                sha // Pass the SHA for updates
            };

            const response = await fetch(url, {
                method: "PUT",
                headers: {
                    Authorization: `token ${token}`,
                    Accept: "application/vnd.github.v3+json"
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                console.log("Successfully updated ICS on GitHub.");
            } else {
                console.error("Failed to update ICS on GitHub:", await response.json());
            }
        } catch (error) {
            console.error("Error during GitHub commit:", error);
            throw error;
        }
    }

    async function runSync(ui) {
        try {
            if (ui && ui.button) {
                ui.button.dataset.busy = "true";
            }
            setSyncStatus(ui, "Sync in progress…");

            const existingICSData = await fetchICSFromGitHub();
            if (!existingICSData) {
                setSyncStatus(ui, "Unable to reach GitHub", "error");
                return;
            }

            const { content: existingICS, sha } = existingICSData;

            console.log("Existing ICS:", existingICS);

            const html = await fetchSchedulePage();
            const scheduleData = parseSchedule(html);

            const mergedICS = mergeAndUpdateICS(scheduleData, existingICS);

            if (mergedICS === existingICS) {
                console.log("No changes to update.");
                setSyncStatus(ui, "Schedule already up to date.", "success");
            } else {
                await commitToGitHub(mergedICS, sha);
                setSyncStatus(ui, "Schedule synced successfully!", "success");
            }
        } catch (error) {
            console.error("Error during script execution:", error);
            setSyncStatus(ui, "Sync failed. Check console.", "error");
        } finally {
            if (ui && ui.button) {
                ui.button.dataset.busy = "false";
            }
            if (ui && ui.status && ui.status.hidden) {
                ui.status.hidden = false;
            }
        }
    }

    function initSyncButton() {
        const ui = insertSyncButton(async (elements) => {
            await runSync(elements);
        });

        return ui;
    }

    function bootstrap() {
        const ui = initSyncButton();
        // Trigger an initial sync but do not block the UI creation.
        runSync(ui);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
    } else {
        bootstrap();
    }
})();
