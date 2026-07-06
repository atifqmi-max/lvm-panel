function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        if (btn) {
            const original = btn.innerText;
            btn.innerText = "Copied!";
            setTimeout(() => btn.innerText = original, 1200);
        }
    });
}

async function vpsAction(vpsId, action, btn) {
    if (btn) { btn.disabled = true; btn.dataset.original = btn.innerText; btn.innerText = "Please wait..."; }
    try {
        const res = await fetch(`/vps/${vpsId}/action/${action}`, { method: "POST" });
        const data = await res.json();
        if (data.ok) {
            location.reload();
        } else {
            alert("Error: " + data.error);
        }
    } catch (e) {
        alert("Request failed: " + e);
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = btn.dataset.original; }
    }
}
