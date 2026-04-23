export const chatWithDolphin = async (prompt, template) => {
    const myHeaders = new Headers();
    myHeaders.append("accept", "text/event-stream");
    myHeaders.append("accept-language", "en-US,en;q=0.9");
    myHeaders.append("cache-control", "no-cache");
    myHeaders.append("content-type", "application/json");
    myHeaders.append("origin", "https://chat.dphn.ai");
    myHeaders.append("pragma", "no-cache");
    myHeaders.append("priority", "u=1, i");
    myHeaders.append("referer", "https://chat.dphn.ai/");
    myHeaders.append("sec-ch-ua", "\"Google Chrome\";v=\"147\", \"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"147\"");
    myHeaders.append("sec-ch-ua-mobile", "?0");
    myHeaders.append("sec-ch-ua-platform", "\"macOS\"");
    myHeaders.append("sec-fetch-dest", "empty");
    myHeaders.append("sec-fetch-mode", "cors");
    myHeaders.append("sec-fetch-site", "same-origin");
    myHeaders.append("user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36");

    const raw = JSON.stringify({
        "messages": [
            {
                "role": "user",
                "content": prompt
            }
        ],
        "model": "dolphinserver:24B",
        "template": template
    });

    const requestOptions = {
        method: "POST",
        headers: myHeaders,
        body: raw,
        redirect: "follow"
    };

    const response = await fetch("https://chat.dphn.ai/api/chat", requestOptions)
    const result = await response.text()
    return result;
}

