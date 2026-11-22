const API_URL = "http://127.0.0.1:8000/api";
let mapa;
let camadaMarcadores;
let todosOsPostes = [];
let marcadoresPorCodigo = {};
let posteSelecionadoCodigo = null;

document.addEventListener("DOMContentLoaded", async () => {
  inicializarMapa();
  configurarBusca();

  const params = new URLSearchParams(window.location.search);
  const codigoUrl = params.get("codigo");
  if (codigoUrl) {
    posteSelecionadoCodigo = codigoUrl;
    const input = document.getElementById("input-poste");
    if (input) input.value = codigoUrl;
  }

  await carregarDados(true);

  // Atualiza em tempo real a cada 5 segundos sem perder o poste selecionado
  setInterval(() => carregarDados(false), 5000);
});

// 1. INICIALIZA O MAPA LEAFLET
function inicializarMapa() {
  const mapEl = document.getElementById("map");
  if (!mapEl) return;

  mapa = L.map("map").setView([-7.2143, -39.3129], 14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(mapa);

  camadaMarcadores = L.layerGroup().addTo(mapa);
}

// 2. CARREGA OS POSTES DA API E ATUALIZA MAPA + PAINEL
async function carregarDados(centralizarNoInicio = false) {
  try {
    const res = await fetch(`${API_URL}/postes`);
    todosOsPostes = await res.json();

    const badgeTotal = document.getElementById("total-postes-badge");
    if (badgeTotal) badgeTotal.textContent = `${todosOsPostes.length} POSTE(S)`;

    desenharPinosNoMapa(todosOsPostes);

    if (posteSelecionadoCodigo) {
      const encontrado = todosOsPostes.find(p => p.codigo_poste === posteSelecionadoCodigo);
      if (encontrado) {
        exibirDetalhesPoste(encontrado, centralizarNoInicio);
        return;
      }
    }

    renderizarListaPostes(todosOsPostes);
  } catch (erro) {
    console.warn("Erro ao carregar postes da API:", erro);
  }
}

// 3. DESENHA OS PINOS NO MAPA (VERMELHO PARA SEM ENERGIA, VERDE/AZUL PARA NORMAL)
function desenharPinosNoMapa(postes) {
  if (!mapa || !camadaMarcadores) return;

  camadaMarcadores.clearLayers();
  marcadoresPorCodigo = {};

  postes.forEach(poste => {
    const lat = parseFloat(poste.latitude);
    const lng = parseFloat(poste.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    const semEnergia = poste.status_energia === "sem_energia";
    const classePino = semEnergia ? "marker-active" : "marker-resolved";
    const corBadge = semEnergia ? "#EF4444" : "#2EB4AF";
    const textoStatus = semEnergia ? "EM ALERTA (SEM ENERGIA)" : "OPERAÇÃO NORMAL";

    const iconeCustom = L.divIcon({
      className: "custom-div-icon",
      html: `<div class="${classePino}" style="width: 20px; height: 20px; border-radius: 50%; background: ${corBadge}; border: 3px solid #fff; box-shadow: 0 0 14px ${corBadge};"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    const marker = L.marker([lat, lng], { icon: iconeCustom });

    marker.bindPopup(`
      <div style="font-family: sans-serif; min-width: 190px;">
        <strong style="font-size: 14px; color: #0F172A;">${poste.codigo_poste}</strong><br>
        <span style="font-size: 12px; color: #475569;">${poste.endereco} - ${poste.bairro}</span>
        <hr style="margin: 6px 0; border: 0; border-top: 1px solid #E2E8F0;">
        <span style="font-size: 11px; font-weight: bold; color: ${corBadge};">${textoStatus}</span><br>
        <span style="font-size: 11px; color: #334155;">Clientes afetados: <strong>${poste.clientes_afetados || 0}</strong></span>
      </div>
    `);

    marker.on("click", () => {
      exibirDetalhesPoste(poste, false);
    });

    marker.addTo(camadaMarcadores);
    marcadoresPorCodigo[poste.codigo_poste] = marker;
  });
}

// 4. EXIBE OS DETALHES DO POSTE (COM BOTÃO DE ACIONAMENTO QUANDO ESTIVER SEM ENERGIA)
function exibirDetalhesPoste(poste, centralizarMapa = true) {
  posteSelecionadoCodigo = poste.codigo_poste;
  const painel = document.getElementById("painel-detalhes-poste");
  if (!painel) return;

  const emAlerta = poste.status_energia === "sem_energia";
  const classeCard = emAlerta ? "em-alerta" : "";
  const classeBadge = emAlerta ? "alerta" : "normal";
  const textoStatus = emAlerta ? "EM ALERTA (SEM ENERGIA)" : "NORMAL";

  // Botão exibido apenas quando o poste está sem energia (alerta crítico)
  // ⚠️ Troque 'acionamento.html' abaixo pelo nome exato do seu arquivo HTML de acionamento de equipes
  const botaoAcionarHTML = emAlerta
    ? `
      <button 
        onclick="window.location.href='pagina06.html?poste=${encodeURIComponent(poste.codigo_poste)}&id=${poste.id_dispositivo}'"
        style="
          margin-top: 6px;
          width: 100%;
          padding: 12px 16px;
          background-color: #EF4444;
          color: #ffffff;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4);
          transition: background 0.2s ease;
        "
        onmouseover="this.style.backgroundColor='#DC2626'"
        onmouseout="this.style.backgroundColor='#EF4444'"
      >
        🚨 Acionar Equipe de Manutenção
      </button>
    `
    : "";

  painel.innerHTML = `
    <div class="detalhe-poste-box ${classeCard}">
      <div class="detalhe-topo">
        <span class="detalhe-codigo">${poste.codigo_poste}</span>
        <span class="badge-status ${classeBadge}">${textoStatus}</span>
      </div>

      <div class="detalhe-grid">
        <div class="detalhe-campo full">
          <span class="detalhe-label">Rua / Endereço</span>
          <span class="detalhe-valor">${poste.endereco || "Não informado"}</span>
        </div>

        <div class="detalhe-campo">
          <span class="detalhe-label">Bairro</span>
          <span class="detalhe-valor">${poste.bairro || "Não informado"}</span>
        </div>

        <div class="detalhe-campo">
          <span class="detalhe-label">Trecho / Clientes</span>
          <span class="detalhe-valor">${poste.trecho_afetado || "-"} (${poste.clientes_afetados || 0})</span>
        </div>

        <div class="detalhe-campo">
          <span class="detalhe-label">Latitude</span>
          <span class="detalhe-valor">${poste.latitude}</span>
        </div>

        <div class="detalhe-campo">
          <span class="detalhe-label">Longitude</span>
          <span class="detalhe-valor">${poste.longitude}</span>
        </div>
      </div>

      ${botaoAcionarHTML}
    </div>
  `;

  const lat = parseFloat(poste.latitude);
  const lng = parseFloat(poste.longitude);
  if (centralizarMapa && mapa && !isNaN(lat) && !isNaN(lng)) {
    mapa.flyTo([lat, lng], 16, { duration: 1.0 });
    const marker = marcadoresPorCodigo[poste.codigo_poste];
    if (marker) marker.openPopup();
  }
}

// 5. LISTA TODOS OS POSTES QUANDO NENHUM ESTÁ SELECIONADO
function renderizarListaPostes(postes) {
  const painel = document.getElementById("painel-detalhes-poste");
  if (!painel) return;

  if (!postes.length) {
    painel.innerHTML = `<p class="texto-vazio">Nenhum poste encontrado.</p>`;
    return;
  }

  painel.innerHTML = postes.map(poste => {
    const semEnergia = poste.status_energia === "sem_energia";
    const classeItem = semEnergia ? "active" : "resolved";
    const classeDot = semEnergia ? "red" : "green";
    const classeBadge = semEnergia ? "active" : "resolved";
    const textoBadge = semEnergia ? "sem energia" : "normal";

    return `
      <div class="city-item ${classeItem} item-clicavel" data-codigo="${poste.codigo_poste}">
        <div class="city-info">
          <span class="dot ${classeDot}"></span>
          <div>
            <span class="city-name">${poste.codigo_poste}</span>
            <span class="city-time" style="display:block;">${poste.endereco} — ${poste.bairro}</span>
          </div>
        </div>
        <span class="badge-status ${classeBadge}">${textoBadge}</span>
      </div>
    `;
  }).join("");

  painel.querySelectorAll(".item-clicavel").forEach(el => {
    el.addEventListener("click", () => {
      const cod = el.getAttribute("data-codigo");
      const poste = todosOsPostes.find(p => p.codigo_poste === cod);
      if (poste) exibirDetalhesPoste(poste, true);
    });
  });
}

// 6. BARRA DE BUSCA E BOTÃO LIMPAR
function configurarBusca() {
  const input = document.getElementById("input-poste");
  const btnBuscar = document.getElementById("btn-buscar-poste");
  const btnLimpar = document.getElementById("btn-limpar-busca");

  async function executarBusca() {
    const termo = input ? input.value.trim() : "";
    if (!termo) {
      posteSelecionadoCodigo = null;
      renderizarListaPostes(todosOsPostes);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/postes/buscar?q=${encodeURIComponent(termo)}`);
      const resultados = await res.json();

      if (resultados.length === 1) {
        exibirDetalhesPoste(resultados[0], true);
      } else {
        posteSelecionadoCodigo = null;
        renderizarListaPostes(resultados);
      }
    } catch (erro) {
      console.error("Erro na busca:", erro);
    }
  }

  if (btnBuscar) btnBuscar.addEventListener("click", executarBusca);
  if (input) {
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") executarBusca();
    });
  }
  if (btnLimpar) {
    btnLimpar.addEventListener("click", () => {
      if (input) input.value = "";
      posteSelecionadoCodigo = null;
      if (mapa) mapa.setView([-7.2143, -39.3129], 14);
      renderizarListaPostes(todosOsPostes);
    });
  }
}