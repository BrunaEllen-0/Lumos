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
    "user": "",
    "password": "",
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


class FinalizarOcorrenciaRequest(BaseModel):
    id_equipe: int | None = None
    observacao: str | None = None


def normalizar_prioridade(valor: str) -> str:
    mapa = {
        "baixa": "baixa",
        "media": "media",
        "média": "media",
        "alta": "alta",
        "critica": "critica",
        "crítica": "critica",
    }
    return mapa.get((valor or "media").strip().lower(), "media")


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
        codigo_poste = payload_json.get("codigo_poste")

        leituras = payload_json.get("leituras", {})
        tensao = leituras.get("tensao_adc", payload_json.get("tensao_volts", payload_json.get("tensao", 0.0)))
        corrente = leituras.get("corrente_adc", payload_json.get("corrente_amp", payload_json.get("corrente", 0.0)))

        continuidade = payload_json.get("continuidade", 1)
        vibracao = payload_json.get("vibracao", 0.0)
        status_energia = payload_json.get("status_energia", "normal")
        status_online = bool(payload_json.get("status_online", 1))

        cursor.execute(
            "SELECT id_dispositivo FROM poste_dispositivo WHERE codigo_poste = %s",
            (codigo_poste,)
        )
        poste = cursor.fetchone()

        if not poste:
            print(f"[MQTT] Poste {codigo_poste} não encontrado em poste_dispositivo.")
            return

        id_dispositivo = poste["id_dispositivo"]

        cursor.execute(
            """
            INSERT INTO dados_processados
                (id_dispositivo, tensao, corrente, continuidade, vibracao, payload_json)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (id_dispositivo, tensao, corrente, continuidade, vibracao, json.dumps(payload_json))
        )
        id_da_leitura = cursor.lastrowid

        estado_poste = "sem_energia" if status_energia in [False, "sem_energia", 0] else "normal"
        cursor.execute(
            """
            UPDATE poste_dispositivo
            SET status_energia = %s, status_online = %s
            WHERE id_dispositivo = %s
            """,
            (estado_poste, status_online, id_dispositivo)
        )

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
        print(f"[MQTT -> DB] {codigo_poste} atualizado | Status: {estado_poste} | Tensão: {tensao} | Corrente: {corrente}")
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
    try:
        dados = json.loads(msg.payload.decode("utf-8"))
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
                p.latitude,
                p.longitude,
                p.bairro,
                p.endereco,
                p.trecho_afetado,
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


@app.get("/api/ocorrencias/{id_ocorrencia}", summary="Detalhar Ocorrencia")
def detalhar_ocorrencia(id_ocorrencia: int):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("""
            SELECT
                a.id_alerta AS id,
                a.id_alerta,
                a.id_dispositivo,
                p.codigo_poste,
                p.latitude,
                p.longitude,
                p.bairro,
                p.endereco,
                p.trecho_afetado,
                p.clientes_afetados,
                a.tipo_evento,
                a.nivel_severidade,
                a.descricao,
                a.data_hora_alerta,
                a.status_alerta
            FROM alerta_ocorrencia a
            JOIN poste_dispositivo p ON a.id_dispositivo = p.id_dispositivo
            WHERE a.id_alerta = %s
        """, (id_ocorrencia,))
        ocorrencia = cursor.fetchone()
        if not ocorrencia:
            raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
        return ocorrencia
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
        prioridade_db = normalizar_prioridade(dados.prioridade)

        cursor.execute("""
            INSERT INTO ordem_do_servico (id_alerta, id_equipe, prioridade, observacao_reparo)
            VALUES (%s, %s, %s, %s)
        """, (dados.id_ocorrencia, dados.id_equipe, prioridade_db, dados.instrucoes))
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
            "id_ordem_servico": id_ordem_servico,
            "prioridade": prioridade_db
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()


@app.post("/api/ocorrencias/{id_ocorrencia}/finalizar", summary="Finalizar Ocorrencia")
def finalizar_ocorrencia(id_ocorrencia: int, dados: FinalizarOcorrenciaRequest):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("""
            SELECT id_dos_chamados, id_equipe, observacao_reparo
            FROM ordem_do_servico
            WHERE id_alerta = %s
            ORDER BY id_dos_chamados DESC
            LIMIT 1
        """, (id_ocorrencia,))
        os_atual = cursor.fetchone()

        if os_atual:
            nova_obs = os_atual["observacao_reparo"] or ""
            if dados.observacao:
                nova_obs = f"{nova_obs}\n[Finalização] {dados.observacao}".strip()

            cursor.execute("""
                UPDATE ordem_do_servico
                SET data_conclusao = CURRENT_TIMESTAMP,
                    observacao_reparo = %s
                WHERE id_dos_chamados = %s
            """, (nova_obs, os_atual["id_dos_chamados"]))

        cursor.execute("""
            UPDATE alerta_ocorrencia
            SET status_alerta = 'resolvido'
            WHERE id_alerta = %s
        """, (id_ocorrencia,))

        id_equipe_liberar = dados.id_equipe or (os_atual["id_equipe"] if os_atual else None)
        if id_equipe_liberar:
            cursor.execute("""
                UPDATE equipes
                SET status = 'disponivel'
                WHERE id_equipe = %s
            """, (id_equipe_liberar,))

        conn.commit()
        return {"mensagem": "Ocorrência finalizada e armazenada no histórico com sucesso!"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()