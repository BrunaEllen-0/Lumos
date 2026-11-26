import json
import threading
import paho.mqtt.client as mqtt
import mysql.connector
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="API Lumos - Monitoramento IoT")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# CONFIGURAÇÃO DO MYSQL LOCAL (WORKBENCH)
# ==========================================
DB_CONFIG = {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "Belg011012@",
    "database": "monitoramento_rede"
}

def get_db():
    return mysql.connector.connect(**DB_CONFIG)


# ==========================================
# 1. MODELOS DE VALIDAÇÃO (PYDANTIC)
# ==========================================
class AcionamentoRequest(BaseModel):
    id_ocorrencia: int
    id_equipe: int
    prioridade: str
    instrucoes: str


# ==========================================
# 2. OUVINTE MQTT (EMQX.IO)
# ==========================================
MQTT_BROKER = "broker.emqx.io"
MQTT_PORT = 1883
MQTT_TOPIC = "pi_iot_juazeiro_2026/#"

def processar_pacote_hardware(payload_json: dict):
    """Salva a leitura do ESP32 em dados_processados e abre alerta_ocorrencia se faltar energia."""
    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    try:
        codigo_poste = payload_json.get("codigo_poste") or payload_json.get("poste")
        
        # Lê do objeto 'leituras' enviado pelo firmware (com fallback para raiz)
        leituras = payload_json.get("leituras", {})
        tensao = leituras.get("tensao_adc", leituras.get("tensao", payload_json.get("tensao_volts", payload_json.get("tensao", 0.0))))
        corrente = leituras.get("corrente_adc", leituras.get("corrente", payload_json.get("corrente_amp", payload_json.get("corrente", 0.0))))
        vibracao = leituras.get("vibracao_adc", leituras.get("vibracao", payload_json.get("vibracao_adc", payload_json.get("vibracao", 0.0))))
        
        continuidade = payload_json.get("continuidade", 1)
        status_energia = payload_json.get("status_energia", "normal")
        status_online = bool(payload_json.get("status_online", 1))

        # 1. Busca o id_dispositivo do poste na tabela poste_dispositivo
        cursor.execute(
            "SELECT id_dispositivo FROM poste_dispositivo WHERE codigo_poste = %s",
            (codigo_poste,)
        )
        poste = cursor.fetchone()

        if not poste:
            print(f"[MQTT] Poste '{codigo_poste}' não encontrado em poste_dispositivo. Pacote: {payload_json}")
            return

        id_dispositivo = poste["id_dispositivo"]

        # 2. Insere a leitura na tabela dados_processados
        cursor.execute(
            """
            INSERT INTO dados_processados 
                (id_dispositivo, tensao, corrente, continuidade, vibracao, payload_json)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (id_dispositivo, tensao, corrente, continuidade, vibracao, json.dumps(payload_json))
        )
        id_da_leitura = cursor.lastrowid

        # 3. Atualiza o status atual do poste em poste_dispositivo
        estado_poste = "sem_energia" if status_energia in [False, "sem_energia", 0] else "normal"
        cursor.execute(
            """
            UPDATE poste_dispositivo 
            SET status_energia = %s, status_online = %s 
            WHERE id_dispositivo = %s
            """,
            (estado_poste, status_online, id_dispositivo)
        )

        # 4. Se caiu a energia (CORTE_PERMANENTE / sem_energia), abre alerta automático
        if estado_poste == "sem_energia":
            cursor.execute(
                """
                SELECT id_alerta FROM alerta_ocorrencia 
                WHERE id_dispositivo = %s AND status_alerta IN ('aberto', 'em_atendimento')
                """,
                (id_dispositivo,)
            )
            ja_aberto = cursor.fetchone()

            if not ja_aberto:
                cursor.execute(
                    """
                    INSERT INTO alerta_ocorrencia 
                        (id_dispositivo, id_da_leitura, tipo_evento, nivel_severidade, descricao, status_alerta)
                    VALUES (%s, %s, 'queda_energia', 'critica', %s, 'aberto')
                    """,
                    (id_dispositivo, id_da_leitura, f"Corte permanente detectado no poste {codigo_poste} (Tensão ADC: {tensao})")
                )

        conn.commit()
        print(f"[MQTT -> DB] {codigo_poste} | Tensão: {tensao} | Corrente: {corrente} | Vibração: {vibracao}")
    except Exception as e:
        conn.rollback()
        print(f"[Erro Banco MQTT]: {e}")
    finally:
        cursor.close()
        conn.close()


def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"[MQTT] Conectado ao EMQX ({MQTT_BROKER}) no tópico {MQTT_TOPIC}!")
        client.subscribe(MQTT_TOPIC)

def on_message(client, userdata, msg):
    raw = msg.payload.decode("utf-8", errors="ignore")
    print(f"[MQTT RECEBIDO] Tópico: {msg.topic} | Mensagem: {raw}")
    try:
        dados = json.loads(raw)
        processar_pacote_hardware(dados)
    except Exception as e:
        print(f"[Erro JSON MQTT]: {e}")

def iniciar_mqtt():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
        client.loop_forever()
    except Exception as e:
        print(f"Não foi possível conectar ao EMQX agora: {e}")

threading.Thread(target=iniciar_mqtt, daemon=True).start()


# ==========================================
# 3. ROTAS REST PARA O FRONTEND (LUMOS)
# ==========================================

@app.get("/api/postes", summary="Listar Postes")
def listar_postes():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("""
            SELECT 
                id_dispositivo AS id,
                id_dispositivo,
                codigo_poste,
                latitude,
                longitude,
                endereco,
                bairro,
                trecho_afetado,
                clientes_afetados,
                protocolo_rede,
                status_online,
                status_energia
            FROM poste_dispositivo
            ORDER BY id_dispositivo
        """)
        return cursor.fetchall()
    finally:
        cursor.close()
        conn.close()


@app.get("/api/postes/buscar", summary="Buscar Postes")
def buscar_postes(q: str = ""):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        termo = f"%{q}%"
        cursor.execute("""
            SELECT 
                id_dispositivo AS id,
                id_dispositivo,
                codigo_poste,
                latitude,
                longitude,
                endereco,
                bairro,
                trecho_afetado,
                clientes_afetados,
                status_online,
                status_energia
            FROM poste_dispositivo
            WHERE codigo_poste LIKE %s OR bairro LIKE %s OR endereco LIKE %s
        """, (termo, termo, termo))
        return cursor.fetchall()
    finally:
        cursor.close()
        conn.close()


@app.get("/api/ocorrencias", summary="Listar Ocorrencias")
def listar_ocorrencias():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("""
            SELECT 
                a.id_alerta AS id,
                a.id_alerta,
                a.id_dispositivo,
                p.codigo_poste,
                p.bairro,
                p.endereco,
                p.clientes_afetados,
                a.tipo_evento,
                a.nivel_severidade,
                a.descricao,
                a.data_hora_alerta,
                a.status_alerta
            FROM alerta_ocorrencia a
            JOIN poste_dispositivo p ON a.id_dispositivo = p.id_dispositivo
            ORDER BY a.data_hora_alerta DESC
        """)
        return cursor.fetchall()
    finally:
        cursor.close()
        conn.close()


@app.get("/api/equipes", summary="Listar Equipes")
def listar_equipes():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("""
            SELECT 
                id_equipe AS id,
                id_equipe,
                nome,
                composicao,
                status,
                latitude,
                longitude
            FROM equipes
            ORDER BY id_equipe
        """)
        return cursor.fetchall()
    finally:
        cursor.close()
        conn.close()


@app.post("/api/acionamentos", summary="Criar Acionamento")
def criar_acionamento(dados: AcionamentoRequest):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("""
            INSERT INTO ordem_do_servico (id_alerta, id_equipe, prioridade, observacao_reparo)
            VALUES (%s, %s, %s, %s)
        """, (dados.id_ocorrencia, dados.id_equipe, dados.prioridade.lower(), dados.instrucoes))
        id_ordem_servico = cursor.lastrowid

        cursor.execute("""
            UPDATE equipes SET status = 'ocupada' WHERE id_equipe = %s
        """, (dados.id_equipe,))

        cursor.execute("""
            UPDATE alerta_ocorrencia SET status_alerta = 'em_atendimento' WHERE id_alerta = %s
        """, (dados.id_ocorrencia,))

        conn.commit()
        return {
            "mensagem": "Equipe acionada e Ordem de Serviço gerada com sucesso!",
            "id_ordem_servico": id_ordem_servico
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()

@app.get("/api/metricas", summary="Métricas para Gráficos da Pagina 05")
def obter_metricas(poste: str | None = None):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("""
            SELECT status_alerta AS status, COUNT(*) AS total
            FROM alerta_ocorrencia
            GROUP BY status_alerta
        """)
        resumo_alertas = cursor.fetchall()

        if poste:
            # Filtra diretamente pelo poste pesquisado (normal ou em alerta)
            cursor.execute("""
                SELECT 
                    d.*,
                    p.codigo_poste,
                    p.bairro
                FROM dados_processados d
                JOIN poste_dispositivo p ON d.id_dispositivo = p.id_dispositivo
                WHERE p.codigo_poste = %s
                ORDER BY d.id_da_leitura DESC
                LIMIT 20
            """, (poste,))
        else:
            # Comportamento padrão quando nenhum poste é passado na URL
            cursor.execute("""
                SELECT 
                    d.*,
                    p.codigo_poste,
                    p.bairro
                FROM dados_processados d
                JOIN poste_dispositivo p ON d.id_dispositivo = p.id_dispositivo
                ORDER BY d.id_da_leitura DESC
                LIMIT 20
            """)

        leituras_recentes = cursor.fetchall()
        leituras_recentes.reverse()

        return {
            "alertas": resumo_alertas,
            "postes": leituras_recentes,
            "leituras": leituras_recentes
        }
    finally:
        cursor.close()
        conn.close()