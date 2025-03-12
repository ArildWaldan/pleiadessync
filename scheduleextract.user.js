
Tampermonkey® by Jan Biniok
v5.3.3
	
PTAPlanning Extractor
by You
1
// ==UserScript==
2
// @name         PTAPlanning Extractor
3
// @namespace    http://tampermonkey.net/
4
// @version      1.3
5
// @description  Extracts schedule data from PTAPlanning, converts to ICS, and updates a local file incrementally without removing existing entries.
6
// @author       You
7
// @match        https://pleiades.gha.kfplc.com/*
8
// @grant        GM_xmlhttpRequest
9
// ==/UserScript==
10
​
11
async function fetchICSFromGitHub() {
12
    const url = "https://api.github.com/repos/ArildWaldan/pleiadessync/contents/test.ics";
13
    const token = "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";
14
​
15
    try {
16
        const response = await fetch(url, {
17
            headers: {
18
                Authorization: `token ${token}`,
19
                Accept: "application/vnd.github.v3+json"
20
            }
21
        });
22
​
23
        if (!response.ok) {
24
            console.error("Failed to fetch existing ICS from GitHub:", await response.json());
25
            return null;
26
        }
27
​
28
        const fileData = await response.json();
29
        const content = atob(fileData.content);
30
        console.log("Fetched ICS from GitHub:", content);
31
        return { content, sha: fileData.sha }; // Return both content and SHA for updates
32
    } catch (error) {
33
        console.error("Error fetching ICS from GitHub:", error);
34
        return null;
35
    }
36
}
37
​
38
async function fetchSchedulePage() {
39
    return fetch("https://pleiades.gha.kfplc.com/pta/pages/planning/PTAPlanningIndividuel.jsp", {
40
        method: "GET",
41
        headers: {
42
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
43
            "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
44
            "Connection": "keep-alive",
45
            "Upgrade-Insecure-Requests": "1",
46
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
47
        }
48
    }).then(response => response.text());
49
}
50
​
51
function parseSchedule(htmlText) {
52
    const parser = new DOMParser();
53
    const doc = parser.parseFromString(htmlText, "text/html");
54
​
55
    const today = new Date();
56
    const endDate = new Date(today);
57
    endDate.setDate(endDate.getDate() + 30);
58
​
59
    const tdElements = Array.from(doc.querySelectorAll("td[id]"));
60
    const scheduleData = [];
61
​
62
    tdElements.forEach(td => {
63
        const id = td.getAttribute("id");
64
        const dateMatch = id && id.match(/^\d{4}\d{2}\d{2}-/);
65
        if (!dateMatch) return;
66
​
