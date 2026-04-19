import requests
import datetime
import os
import base64
import json
from urllib.parse import unquote

def send_report(user_id, m_val, i_val=None):
    """
    Отправка отчета в Telegram
    i_val может быть None (если параметр не передан)
    """
    token = os.getenv("TELEGRAM_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    
    if not token or not chat_id:
        return

    # Настройка московского времени (UTC+3)
    offset = datetime.timezone(datetime.timedelta(hours=3))
    now_moscow = datetime.datetime.now(offset).strftime("%d.%m.%Y %H:%M:%S")

    # Декодируем параметр i (если есть)
    user_info_text = ""
    if i_val:
        try:
            # Шаг 1: Декодируем base64
            decoded_bytes = base64.b64decode(i_val)
            decoded_str = decoded_bytes.decode('utf-8')
            
            # Шаг 2: Декодируем URL-encoding
            url_decoded = unquote(decoded_str)
            
            # Шаг 3: Парсим JSON
            user_info = json.loads(url_decoded)
            
            # Форматируем для сообщения
            first_name = user_info.get('first_name', '?')
            last_name = user_info.get('last_name', '?')
            vk_id = user_info.get('id', '?')
            city = user_info.get('city', {}).get('title', 'не указан') if user_info.get('city') else 'не указан'
            
            user_info_text = f"{first_name} {last_name} (ID: {vk_id}, {city})"
            
        except Exception as e:
            user_info_text = "ошибка декодирования"

    # Формируем текст сообщения
    message = (
        f"📊 *Запуск навигатора*\n"
        f"🕒 `{now_moscow}`\n"
        f"🆔 Маршрут: `{user_id}`-`{m_val}`\n"
        f"👤 Пользователь: {user_info_text}"
    )

    try:
        # Отправляем GET-запрос в Telegram
        requests.get(
            f"https://api.telegram.org/bot{token}/sendMessage",
            params={
                "chat_id": chat_id, 
                "text": message,
                "parse_mode": "Markdown"
            },
            timeout=2 
        )
    except Exception:
        # "Тихий" режим: если Telegram не ответил, пользователь функции этого не увидит
        pass