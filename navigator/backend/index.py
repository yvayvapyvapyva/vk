import os
import ydb
import ydb.iam
import json
import notifier

# Инициализация YDB
driver_config = ydb.DriverConfig(
    os.getenv("YDB_ENDPOINT"),
    os.getenv("YDB_DATABASE"),
    credentials=ydb.iam.MetadataUrlCredentials()
)
driver = ydb.Driver(driver_config)
driver.wait(timeout=5)
pool = ydb.SessionPool(driver)

def execute_select(session, id_param, m_param):
    query = """
        DECLARE $id AS Utf8;
        DECLARE $m AS Utf8;
        SELECT json FROM roads WHERE id = $id AND m = $m;
    """
    prepared_query = session.prepare(query)
    return session.transaction().execute(
        prepared_query,
        {'$id': str(id_param), '$m': str(m_param)},
        commit_tx=True,
    )

def execute_list_routes(session):
    """Получение списка видимых маршрутов для меню"""
    query = """
        SELECT DISTINCT id, m, name, description
        FROM roads
        WHERE visible = true AND name IS NOT NULL
        ORDER BY name;
    """
    prepared_query = session.prepare(query)
    return session.transaction().execute(
        prepared_query,
        commit_tx=True,
    )

def handler(event, context):
    params = event.get('queryStringParameters', {})

    # Обработка запроса списка маршрутов
    if params.get('action') == 'list_routes':
        try:
            result_sets = pool.retry_operation_sync(execute_list_routes)
            routes = []
            for row in result_sets[0].rows:
                routes.append({
                    'id': row.id,
                    'm': row.m,
                    'name': row.name,
                    'description': row.description if hasattr(row, 'description') and row.description else ''
                })
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                },
                'body': json.dumps(routes, ensure_ascii=False)
            }
        except Exception as e:
            return {
                'statusCode': 500,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'internal_error', 'message': str(e)})
            }

    # Обработка запроса конкретного маршрута
    id_val = params.get('id')
    m_val = params.get('m')
    i_val = params.get('i')

    # 1. Проверка параметров
    if not id_val or not m_val:
        return {'statusCode': 400, 'body': json.dumps({'error': 'bad_params'})}

    # 2. Тихая отправка отчета (незаметно для пользователя)
    notifier.send_report(id_val, m_val, i_val)

    try:
        # 3. Поиск в БД
        result_sets = pool.retry_operation_sync(execute_select, id_param=id_val, m_param=m_val)

        if not result_sets[0].rows:
            return {'statusCode': 404, 'body': json.dumps({'error': 'not_found'})}

        # Получаем данные из колонки 'json'
        raw_data = result_sets[0].rows[0].json

        # Если в базе лежит готовый JSON-объект, возвращаем его строкой
        # Если строка — возвращаем как есть. Главное — Content-Type.
        response_body = raw_data if isinstance(raw_data, str) else json.dumps(raw_data)

        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': response_body
        }

    except Exception as e:
        return {'statusCode': 500, 'body': json.dumps({'error': 'internal_error'})}