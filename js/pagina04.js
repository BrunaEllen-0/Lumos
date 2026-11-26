const MQTT_TOPIC = "pi_iot_juazeiro_2026/#";
const alertasCriticosAtivos = new Map();
let mqttConectado = false;

document.addEventListener("DOMContentLoaded", () => {
  renderizarAlertasCriticos();
  iniciarMqttAlertas();
});

function iniciarMqttAlertas() {
  if (typeof mqtt === "undefined") {
    atualizarStatusConexao("Biblioteca MQTT não carregada");
    return;
  }

  const brokerUrl = window.location.protocol === "https:"
    ? "wss://broker.emqx.io:8084/mqtt"
    : "ws://broker.emqx.io:8083/mqtt";

  const clientId = "lumos-alertas-" + Math.random().toString(16).slice(2, 8);
  const client = mqtt.connect(brokerUrl, {
    clientId,
    clean: true,
    reconnectPeriod: 3000,
  });

  client.on("connect", () => {
    mqttConectado = true;
    atualizarStatusConexao("Tempo real ativo via EMQX (pi_iot_juazeiro_2026/#)");
    client.subscribe(MQTT_TOPIC, (err) => {
      if (err) {
        console.error("[MQTT Alertas] Erro ao assinar tópico:", err);
      }
    });
    renderizarAlertasCriticos();
  });

  client.on("reconnect", () => {
    mqttConectado = false;
    alertasCriticosAtivos.clear();
    atualizarStatusConexao("Conexão perdida — reconectando ao EMQX...");
    renderizarAlertasCriticos();
  });

  client.on("offline", () => {
    mqttConectado = false;
    alertasCriticosAtivos.clear();
    atualizarStatusConexao("Sem conexão com o broker MQTT");
    renderizarAlertasCriticos();
  });

  client.on("error", (err) => {
    console.error("[MQTT Alertas] Erro:", err);
    mqttConectado = false;
    atualizarStatusConexao("Erro na conexão MQTT");
    renderizarAlertasCriticos();
  });

  client.on("message", (topic, payload) => {
    try {
      const dados = JSON.parse(payload.toString());
      processarMensagemAlerta(dados, topic);
    } catch (erro) {
      console.error("[MQTT Alertas] JSON inválido:", erro);
    }
  });
}

function processarMensagemAlerta(dados, topic) {
  const id = dados.id ?? topic;
  const chave = String(id);
  const status = String(dados.status || "").toUpperCase();
  const ehCriticoReal =
    status === "CORTE_PERMANENTE" ||
    status === "CORTE_CONFIRMADO" ||
    status === "CRITICO";

  // Só mantém na lista de alertas críticos reais o que estiver em estado crítico
  if (!ehCriticoReal) {
    if (alertasCriticosAtivos.has(chave)) {
      alertasCriticosAtivos.delete(chave);
      renderizarAlertasCriticos();
    }
    return;
  }

  const localidade = dados.localidade || "Localidade não informada";
  const tensaoAdc = Number(dados.leituras?.tensao_adc ?? 0);
  const correnteAdc = Number(dados.leituras?.corrente_adc ?? 0);
  const tentativas = Number(dados.tentativas ?? 0);
  const hora = new Date().toLocaleTimeString("pt-BR");

  alertasCriticosAtivos.set(chave, {
    id,
    status,
    localidade,
    tensaoAdc,
    correnteAdc,
    tentativas,
    hora,
  });

  renderizarAlertasCriticos();
}

function renderizarAlertasCriticos() {
  const listaEl = document.getElementById("alertas-criticos-lista");
  const badgeEventos = document.getElementById("contador-eventos-hoje");
  const badgeMenu = document.getElementById("badge-alertas-criticos");

  if (!listaEl) return;

  const itens = Array.from(alertasCriticosAtivos.values());
  const total = mqttConectado ? itens.length : 0;

  if (badgeEventos) {
    badgeEventos.textContent = `${total} ${total === 1 ? "ALERTA CRÍTICO" : "ALERTAS CRÍTICOS"}`;
  }
  if (badgeMenu) {
    badgeMenu.textContent = String(total);
  }

  if (!mqttConectado) {
    listaEl.innerHTML = `<p style="color: #94A3B8; padding: 16px 0;">Aguardando conexão MQTT para exibir alertas críticos reais.</p>`;
    return;
  }

  if (itens.length === 0) {
    listaEl.innerHTML = `<p style="color: #94A3B8; padding: 16px 0;">Nenhum alerta crítico real ativo no momento.</p>`;
    return;
  }

  listaEl.innerHTML = itens
    .map((alerta) => {
      const params = new URLSearchParams({
        id: String(alerta.id),
        localidade: alerta.localidade,
        status: alerta.status,
      }).toString();

      return `
        <div class="card-alerta border-critico">
          <div class="alerta-header">
            <div class="alerta-titulo-group">
              <img src="../img/alerta01.png" alt="Alerta Crítico" class="alerta-icone-img">
              <h2>${alerta.status} — Dispositivo ID ${alerta.id}</h2>
              <span class="alerta-hora">${alerta.hora}</span>
            </div>
            <span class="badge-alerta critico">crítico</span>
          </div>
          <p class="alerta-descricao">
            Tensão ADC: <strong>${alerta.tensaoAdc.toFixed(1)}</strong> ·
            Corrente ADC: <strong>${alerta.correnteAdc.toFixed(1)}</strong> ·
            Tentativas: <strong>${alerta.tentativas}</strong>
          </p>
          <p class="alerta-localizacao">${alerta.localidade} · ID ${alerta.id}</p>
          <div class="alerta-acoes">
            <a href="pagina06.html?${params}">
              <button type="button" class="btn-acionar">Acionar equipe de campo</button>
            </a>
            <a href="pagina05.html?${params}">
              <button type="button" class="btn-historico">Ver histórico do sensor</button>
            </a>
          </div>
        </div>
      `;
    })
    .join("");
}

function atualizarStatusConexao(texto) {
  const el = document.getElementById("status-conexao-alertas");
  if (el) el.textContent = texto;
}