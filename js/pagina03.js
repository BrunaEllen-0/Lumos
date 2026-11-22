const TOTAL_KM_REDE = 360;
const KM_POR_PROTOTIPO = 180;
const LIMIAR_SENSOR = 500;
const MS_24_HORAS = 24 * 60 * 60 * 1000;
const MQTT_TOPIC = "pi_iot_juazeiro_2026/#";

const prototipos = new Map();
let mqttConectado = false;

document.addEventListener("DOMContentLoaded", () => {
  zerarPainelSemDados("Aguardando dados dos protótipos conectados");
  iniciarConexaoMqtt();
  setInterval(recalcularVisaoGeral, 60000);
});

/**
 * CONEXÃO EM TEMPO REAL VIA WEBSOCKETS COM BROKER.EMQX.IO
 */
function iniciarConexaoMqtt() {
  if (typeof mqtt === "undefined") {
    console.error("Biblioteca mqtt.js não carregada.");
    atualizarBadgeSistema("MQTT INDISPONÍVEL", false);
    zerarPainelSemDados("Biblioteca MQTT não carregada");
    return;
  }

  const brokerUrl = window.location.protocol === "https:"
    ? "wss://broker.emqx.io:8084/mqtt"
    : "ws://broker.emqx.io:8083/mqtt";

  const clientId = "lumos-status-geral-" + Math.random().toString(16).slice(2, 8);
  const client = mqtt.connect(brokerUrl, {
    clientId,
    clean: true,
    reconnectPeriod: 3000,
  });

  client.on("connect", () => {
    mqttConectado = true;
    atualizarBadgeSistema("SISTEMA ONLINE", true);
    client.subscribe(MQTT_TOPIC, (err) => {
      if (err) {
        console.error("[MQTT] Erro ao assinar tópico:", err);
      }
    });
  });

  client.on("reconnect", () => {
    mqttConectado = false;
    atualizarBadgeSistema("RECONECTANDO MQTT", false);
    zerarPainelSemDados("Conexão perdida — aguardando reconexão");
  });

  client.on("offline", () => {
    mqttConectado = false;
    atualizarBadgeSistema("SEM CONEXÃO MQTT", false);
    zerarPainelSemDados("Sem conexão com o broker — nenhum dado exibido");
  });

  client.on("error", (err) => {
    console.error("[MQTT] Erro:", err);
    mqttConectado = false;
    atualizarBadgeSistema("ERRO MQTT", false);
    zerarPainelSemDados("Falha na conexão MQTT");
  });

  client.on("message", (topic, payload) => {
    try {
      const dados = JSON.parse(payload.toString());
      processarPacoteMqtt(dados, topic);
    } catch (erro) {
      console.error("[MQTT] JSON inválido:", erro);
    }
  });
}

/**
 * ATUALIZA O ESTADO DO PROTÓTIPO COM BASE APENAS NO JSON RECEBIDO
 */
function processarPacoteMqtt(dados, topic) {
  const chave = String(dados.id ?? topic);
  const correnteAdc = Number(dados.leituras?.corrente_adc ?? 0);
  const tensaoAdc = Number(dados.leituras?.tensao_adc ?? 0);
  const tentativas = Number(dados.tentativas ?? 0);
  const statusMqtt = String(dados.status || "").toUpperCase();

  prototipos.set(chave, {
    correnteAdc,
    tensaoAdc,
    tentativas,
    statusMqtt,
    ultimaAtualizacao: Date.now(),
  });

  atualizarHoraSincronizacao(new Date());
  recalcularVisaoGeral();
}

/**
 * RECALCULA APENAS COM DADOS REAIS RECEBIDOS DOS PROTÓTIPOS
 */
function recalcularVisaoGeral() {
  if (!mqttConectado || prototipos.size === 0) {
    zerarPainelSemDados(
      !mqttConectado
        ? "Conexão perdida — sem dados reais no momento"
        : "Aguardando dados dos protótipos conectados"
    );
    return;
  }

  const agora = Date.now();
  let correnteAtiva = 0;
  let vibracaoAtiva = 0;
  let offline24h = 0;

  let normais = 0;
  let alerta = 0;
  let criticos = 0;

  prototipos.forEach((p) => {
    const semResposta24h = (agora - p.ultimaAtualizacao) >= MS_24_HORAS;

    // Cada sensor é avaliado de forma independente em relação ao limiar 500
    const correnteOk = p.correnteAdc >= LIMIAR_SENSOR;
    const tensaoOk = p.tensaoAdc >= LIMIAR_SENSOR;

    if (semResposta24h) {
      offline24h += 1;
    } else {
      if (correnteOk) correnteAtiva += 1;
      if (tensaoOk) vibracaoAtiva += 1;
    }

    const ehCritico =
      p.statusMqtt === "CORTE_PERMANENTE" ||
      p.statusMqtt === "CORTE_CONFIRMADO" ||
      p.statusMqtt === "CRITICO";

    // Basta um dos sensores estar abaixo de 500 para entrar em ALERTA
    const algumSensorAbaixo500 = !correnteOk || !tensaoOk;

    if (ehCritico) {
      criticos += 1;
    } else if (algumSensorAbaixo500 || p.tentativas > 0 || p.statusMqtt === "ALERTA") {
      alerta += 1;
    } else {
      normais += 1;
    }
  });

  const cobertos = Math.min(TOTAL_KM_REDE, prototipos.size * KM_POR_PROTOTIPO);
  const porcentagem = Math.round((cobertos / TOTAL_KM_REDE) * 100);

  atualizarCabosMonitorados(
    cobertos,
    TOTAL_KM_REDE,
    `${porcentagem}% da rede prioritária com sensoriamento ativo (${prototipos.size} protótipo(s))`
  );

  atualizarStatusGeral({
    normais,
    alerta,
    criticos,
    resumo: criticos > 0
      ? "Corte crítico detectado"
      : alerta > 0
        ? "Alerta em sensor (< 500)"
        : "Operação normal",
  });

  atualizarSensores({
    corrente: correnteAtiva,
    vibracao: vibracaoAtiva,
    offline24h,
  });
}

/**
 * ZERA OS CONTADORES QUANDO NÃO HÁ DADOS REAIS OU HÁ PERDA DE CONEXÃO
 */
function zerarPainelSemDados(mensagemRodape) {
  atualizarCabosMonitorados(0, TOTAL_KM_REDE, mensagemRodape);
  atualizarStatusGeral({
    normais: 0,
    alerta: 0,
    criticos: 0,
    resumo: "Sem dados em tempo real",
  });
  atualizarSensores({
    corrente: 0,
    vibracao: 0,
    offline24h: 0,
  });
}

function atualizarBadgeSistema(texto, online) {
  const textEl = document.getElementById("mqtt-system-text");
  const dotEl = document.querySelector("#mqtt-system-badge .dot-online");

  if (textEl) textEl.textContent = texto;
  if (dotEl) {
    dotEl.style.backgroundColor = online ? "#2EB4AF" : "#EF4444";
  }
}

function atualizarHoraSincronizacao(dataObj) {
  const syncTimeElement = document.querySelector(".sync-time");
  if (!syncTimeElement) return;

  const horas = String(dataObj.getHours()).padStart(2, "0");
  const minutos = String(dataObj.getMinutes()).padStart(2, "0");
  const segundos = String(dataObj.getSeconds()).padStart(2, "0");
  syncTimeElement.textContent = `${horas}:${minutos}:${segundos}`;
}

function atualizarCabosMonitorados(cobertos, total, textoRodape) {
  const porcentagem = total > 0 ? Math.round((cobertos / total) * 100) : 0;
  const graus = Math.round((porcentagem / 100) * 360);

  const numberEl = document.querySelector(".chart-center .number");
  const labelEl = document.querySelector(".chart-center .label");
  const footerEl = document.querySelector(".chart-footer");
  const donutChart = document.querySelector(".donut-chart");

  if (numberEl) numberEl.textContent = cobertos;
  if (labelEl) labelEl.textContent = `de ${total} km cobertos`;
  if (footerEl && textoRodape) footerEl.textContent = textoRodape;

  if (donutChart) {
    donutChart.style.background = `conic-gradient(#2EB4AF 0deg ${graus}deg, #1E293B ${graus}deg 360deg)`;
  }
}

function atualizarStatusGeral({ normais, alerta, criticos, resumo }) {
  const normaisEl = document.querySelector(".text-success");
  const alertaEl = document.querySelector(".data-list .text-warning");
  const criticosEl = document.querySelector(".data-list .text-danger");
  const resumoEl = document.getElementById("status-geral-texto");

  if (normaisEl) normaisEl.textContent = normais;
  if (alertaEl) alertaEl.textContent = alerta;
  if (criticosEl) criticosEl.textContent = criticos;
  if (resumoEl && resumo) resumoEl.textContent = resumo;
}

function atualizarSensores({ corrente, vibracao, offline24h }) {
  const items = document.querySelectorAll(".cards-grid .status-card:nth-child(3) .item-value");

  if (items.length >= 3) {
    items[0].innerHTML = `${corrente} <small>ativos</small>`;
    items[1].innerHTML = `${vibracao} <small>ativos</small>`;
    items[2].innerHTML = `${offline24h} <small>unidades</small>`;
  }
}