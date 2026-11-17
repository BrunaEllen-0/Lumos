import json
import threading
import mysql.connector
import paho.mqtt.client as mqtt
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="API Lumos - Monitoramento IoT")

# Libera o acesso para o teu Frontend (HTML/JS) consumir a API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 1. CONFIGURAÇÃO DO BANCO DE DADOS (MYSQL)
# ==========================================
DB_CONFIG = {
    "host": "localhost",          # Se rodar no Docker, mude para "mysql"
    "user": "root",
    "password": "lumos_password123",
    "database": "lumos_db"
}

def get_db():
    return mysql.connector.connect(**DB_CONFIG)

# ==========================================
# 2. OUVINTE MQTT (RECEBE DO HIVEMQ/HARDWARE)
# ==========================================
MQTT_BROKER = "localhost"         # Se rodar no Docker, mude para "hivemq"
MQTT_PORT = 1883
MQTT_TOPIC = "lumos/telemetria/postes"

def processar_pacote_hardware(payload_json: dict):
    """Salva a leitura e abre ocorrência automática se faltar energia."""
    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    try:
        codigo_poste = payload_json.get("codigo_poste")
        tensao = payload_json.get("tensao_volts", 0.0)
        corrente = payload_json.get("corrente_amp", 0.0)
        status_energia = payload_json.get("status_energia", True)

        # Busca o ID do poste no banco da Bia
        cursor.execute("SELECT id_poste, status_energia FROM postes WHERE codigo = %s", (codigo_poste,))
        poste = cursor.fetchone()

        if not poste:
            print(f"[AVISO] Poste {codigo_poste} não cadastrado no banco.")
            return

        id_poste = poste["id_poste"]

        # 1. Grava o histórico na tabela leituras_telemetria
        cursor.execute(
            """INSERT INTO leituras_telemetria (id_poste, tensao_volts, corrente_amp, status_energia)
               VALUES (%s, %s, %s, %s)""",
            (id_poste, tensao, corrente, status_energia)
        )

        # 2. Regra de negócio: Se acabou a energia, atualiza o poste e cria ocorrência
        novo_status = "NORMAL" if status_energia else "SEM_ENERGIA"
        cursor.execute("UPDATE postes SET status_energia = %s WHERE id_poste = %s", (novo_status, id_poste))

        if not status_energia and poste["status_energia"] == "NORMAL":
            cursor.execute(
                """INSERT INTO ocorrencias (id_poste, descricao, prioridade, status)
                   VALUES (%s, %s, 'Crítica', 'Pendente')""",
                (id_poste, f"Interrupção de energia detectada no poste {codigo_poste}")
            )
            print(f"[ALERTA CRÍTICO] Ocorrência aberta para o poste {codigo_poste}!")

        conn.commit()
    except Exception as e:
        print(f"[ERRO BANCO] {e}")
    finally:
        cursor.close()
        conn.close()

def on_connect(client, userdata, flags, rc):
    print("Conectado ao Broker HiveMQ! Escutando tópico:", MQTT_TOPIC)
    client.subscribe(MQTT_TOPIC)

def on_message(client, userdata, msg):
    try:
        dados = json.loads(msg.payload.decode())
        print("Pacote recebido do hardware:", dados)
        processar_pacote_hardware(dados)
    except Exception as e:
        print("Erro ao ler JSON do MQTT:", e)

def iniciar_mqtt():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
        client.loop_forever()
    except Exception as e:
        print("Não foi possível conectar ao HiveMQ agora:", e)

# Inicia o ouvinte MQTT em paralelo quando a API ligar
@app.on_event("startup")
def startup_event():
    thread = threading.Thread(target=iniciar_mqtt, daemon=True)
    thread.start()

# ==========================================
# 3. ROTAS DA API REST (PARA O FRONTEND)
# ==========================================

# Rota da Página 1: Listar todos os postes (para o mapa interativo)
@app.get("/api/postes")
def listar_postes():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM postes")
    dados = cursor.fetchall()
    cursor.close()
    conn.close()
    return dados

# Rota da Página 1: Barra de busca de postes
@app.get("/api/postes/buscar")
def buscar_postes(q: str):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    termo = f"%{q}%"
    cursor.execute(
        """SELECT id_poste, codigo, endereco, bairro, trecho_afetado, status_energia, clientes_afetados
           FROM postes WHERE codigo LIKE %s OR endereco LIKE %s LIMIT 5""",
        (termo, termo)
    )
    resultados = cursor.fetchall()
    cursor.close()
    conn.close()
    return resultados

# Rota da Página 4: Listar ocorrências ativas
@app.get("/api/ocorrencias")
def listar_ocorrencias():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute(
        """SELECT o.*, p.codigo AS codigo_poste, p.endereco, p.bairro
           FROM ocorrencias o
           JOIN postes p ON o.id_poste = p.id_poste
           ORDER BY o.data_abertura DESC"""
    )
    dados = cursor.fetchall()
    cursor.close()
    conn.close()
    return dados

# Rota da Página 6: Listar equipes para despacho
@app.get("/api/equipes")
def listar_equipes():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM equipes")
    dados = cursor.fetchall()
    cursor.close()
    conn.close()
    return dados

# Modelo de dados que vem do Modal da Página 6
class AcionamentoRequest(BaseModel):
    id_ocorrencia: int
    id_equipe: int
    prioridade: str
    instrucoes: str = ""

# Rota da Página 6: Confirmar acionamento de equipe
@app.post("/api/acionamentos")
def criar_acionamento(dados: AcionamentoRequest):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """INSERT INTO acionamentos (id_ocorrencia, id_equipe, prioridade, instrucoes)
               VALUES (%s, %s, %s, %s)""",
            (dados.id_ocorrencia, dados.id_equipe, dados.prioridade, dados.instrucoes)
        )
        cursor.execute("UPDATE equipes SET status = 'Ocupada' WHERE id_equipe = %s", (dados.id_equipe,))
        cursor.execute("UPDATE ocorrencias SET status = 'Em Atendimento' WHERE id_ocorrencia = %s", (dados.id_ocorrencia,))
        conn.commit()
        return {"mensagem": "Equipe acionada com sucesso!"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()