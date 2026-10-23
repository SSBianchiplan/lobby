import uuid

from .conftest import admin, make_user


async def test_access_log_records_auth_events(client):
    adm = await admin(client)
    await make_user(client)
    await client.post("/api/auth/login", json={"email": "ana@ex.com", "password": "errada"}, headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari/604.1"})
    await client.post("/api/auth/login", json={"email": "ana@ex.com", "password": "segredo123"})
    log = (await client.get("/api/admin/logs/access", headers=adm)).json()
    events = [i["event"] for i in log["items"]]
    assert {"register", "login_fail", "login_ok"} <= set(events)
    fail = next(i for i in log["items"] if i["event"] == "login_fail")
    assert fail["email"] == "ana@ex.com" and fail["os"] == "iOS" and fail["device"] == "mobile"
    assert log["top_failed_emails"][0]["email"] == "ana@ex.com"
    only = (await client.get("/api/admin/logs/access?event=login_ok", headers=adm)).json()
    assert {i["event"] for i in only["items"]} == {"login_ok"}
    # ação da administração fica com o autor
    uid = (await client.get("/api/admin/users?q=ana", headers=adm)).json()[0]["id"]
    await client.put(f"/api/admin/users/{uid}/active", json={"active": False}, headers=adm)
    dis = (await client.get("/api/admin/logs/access?event=account_disabled", headers=adm)).json()["items"][0]
    assert dis["actor_name"] == "Administração" and dis["user_name"] == "Ana Souza"
    ana = await make_user(client, "bia@ex.com", "Bia Lima")
    assert (await client.get("/api/admin/logs/access", headers=ana)).status_code == 403


async def test_visitor_tracking_is_anonymous_and_aggregated(client):
    adm = await admin(client)
    v1, v2, s1, s2 = (str(uuid.uuid4()) for _ in range(4))
    ua_m = {"User-Agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36"}
    ua_d = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36 Edg/130"}
    bot = {"User-Agent": "WhatsApp/2.23 (link preview)"}
    for path, v, s, h, ref in [("/", v1, s1, ua_m, "https://www.instagram.com/padellobby"), ("/agenda?x=1", v1, s1, ua_m, None),
                               ("/convite/3d2f8f59-ad36-482b-8921-36f81ca04f1f", v2, s2, ua_d, "https://web.whatsapp.com/"), ("/", v2, s2, bot, None)]:
        r = await client.post("/api/track", json={"path": path, "referrer": ref, "visitor": v, "session": s}, headers=h)
        assert r.status_code == 204
    d = (await client.get("/api/admin/logs/visitors", headers=adm)).json()
    assert d["views"] == 3 and d["visitors"] == 2 and d["bot_views"] == 1 and d["new_visitors"] == 2
    pages = {p["key"]: p["views"] for p in d["pages"]}
    assert pages == {"/": 1, "/agenda": 1, "/convite/:token": 1}  # sem query e sem token
    assert {r["key"] for r in d["referrers"]} == {"www.instagram.com", "web.whatsapp.com", "Direto / sem origem"}
    assert {r["key"]: r["views"] for r in d["devices"]} == {"mobile": 2, "desktop": 1}
    assert d["recent"][0]["ip_prefix"].endswith(".x") or d["recent"][0]["ip_prefix"] is None
    assert (await client.get("/api/admin/logs/visitors?bots=true", headers=adm)).json()["views"] == 4
    ana = await make_user(client)
    assert (await client.get("/api/admin/logs/visitors", headers=ana)).status_code == 403
