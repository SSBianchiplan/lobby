import asyncpg


async def notify(conn: asyncpg.Connection, user_id: int, kind: str, title: str, body: str = "", link: str | None = None) -> None:
    await conn.execute(
        "INSERT INTO notifications (user_id, kind, title, body, link) VALUES ($1, $2, $3, $4, $5)",
        user_id, kind, title, body, link,
    )


async def notify_players(conn: asyncpg.Connection, reservation_id: int, kind: str, title: str, body: str = "",
                         link: str | None = None, exclude: int | None = None) -> None:
    """Notifica dono e jogadores com conta vinculados à reserva."""
    rows = await conn.fetch(
        """
        SELECT DISTINCT user_id FROM (
            SELECT user_id FROM reservations WHERE id = $1
            UNION ALL
            SELECT user_id FROM reservation_players WHERE reservation_id = $1 AND user_id IS NOT NULL
        ) u WHERE user_id IS DISTINCT FROM $2
        """,
        reservation_id, exclude,
    )
    for r in rows:
        await notify(conn, r["user_id"], kind, title, body, link)
