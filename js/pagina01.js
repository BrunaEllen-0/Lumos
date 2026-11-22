const API_URL = "http://127.0.0.1:8000/api";
let mapa;
let camadaMarcadores;
let ultimaAtualizacao = Date.now();

document.addEventListener("DOMContentLoaded", async () => {
  inicializarMapa();
  configurarBuscaPostes();

  await atualizarDashboard();

  // Atualiza mapa e lista em tempo real a cada 5 segundos
  setInterval(atualizarDashboard, 5000);

  // Atualiza o contador "ATUALIZADO HÁ X s" a cada segundo
  setInterval(() => {
    const elTempo = document.querySelector(".status-time");
    if (elTempo) {
      const segs = Math.floor((Date.now() - ultimaAtualizacao) / 1000);
      elTempo.textContent = `ATUALIZADO HÁ ${segs} s`;
    }
  }, 1000);
});

// 1. INICIALIZA O MAPA LEAFLET (Foco em Juazeiro do Norte - CE)
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

// 2. BUSCA OS POSTES REAIS DA API E ATUALIZA MAPA, CIDADES PRIORITÁRIAS E BADGES
async function atualizarDashboard() {
  try {
    const res = await fetch(`${API_URL}/postes`);
    const postes = await res.json();

    ultimaAtualizacao = Date.now();

    desenharPostesNoMapa(postes);
    renderizarCidadesPrioritarias(postes);
    atualizarBadgesSidebar(postes);
  } catch (erro) {
    console.warn("Não foi possível carregar os postes da API:", erro);
  }
}

// 3. DESENHA OS PINOS NO MAPA
function desenharPostesNoMapa(postes) {
  if (!mapa || !camadaMarcadores) return;

  camadaMarcadores.clearLayers();

  postes.forEach(poste => {
    const lat = parseFloat(poste.latitude);
    const lng = parseFloat(poste.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    const semEnergia = poste.status_energia === "sem_energia";
    const classePino = semEnergia ? "marker-active" : "marker-resolved";
    const corBadge = semEnergia ? "#EF4444" : "#2EB4AF";
    const textoStatus = semEnergia ? "SEM ENERGIA (CRÍTICO)" : "ENERGIA NORMAL";

    const iconeCustom = L.divIcon({
      className: "custom-div-icon",
      html: `<div class="${classePino}" style="width: 18px; height: 18px; border-radius: 50%; background: ${corBadge}; border: 3px solid #fff; box-shadow: 0 0 12px ${corBadge};"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    const marker = L.marker([lat, lng], { icon: iconeCustom });

    marker.bindPopup(`
      <div style="font-family: sans-serif; min-width: 180px;">
        <strong style="font-size: 14px; color: #0F172A;">${poste.codigo_poste}</strong><br>
        <span style="font-size: 12px; color: #475569;">${poste.endereco} - ${poste.bairro}</span>
        <hr style="margin: 6px 0; border: 0; border-top: 1px solid #E2E8F0;">
        <span style="font-size: 11px; font-weight: bold; color: ${corBadge};">${textoStatus}</span><br>
        <span style="font-size: 11px; color: #334155;">Clientes afetados: <strong>${poste.clientes_afetados || 0}</strong></span><br>
        <a href="consulta_poste.html?codigo=${encodeURIComponent(poste.codigo_poste)}" style="display:inline-block; margin-top:6px; font-size:11px; color:#0284c7; font-weight:bold;">Ver detalhes completos →</a>
      </div>
    `);

    marker.addTo(camadaMarcadores);
  });
}

// 4. RENDERIZA O CARD "CIDADES PRIORITÁRIAS" COM AS CLASSES EXATAS DO pagina01.html
function renderizarCidadesPrioritarias(postes) {
  const listaContainer = document.querySelector(".cidades-lista");
  const contadorRegioes = document.querySelector(".regioes-count");
  if (!listaContainer) return;

  const ativos = postes.filter(p => p.status_energia === "sem_energia");

  if (contadorRegioes) {
    contadorRegioes.textContent = `${ativos.length} ATIVA(S) • ${postes.length} POSTES`;
  }

  if (!postes.length) {
    listaContainer.innerHTML = `<p style="color:#94A3B8; font-size:13px; padding:12px;">Nenhum poste cadastrado.</p>`;
    return;
  }

  // Ordena: postes SEM ENERGIA aparecem sempre no topo
  const ordenados = [...postes].sort((a, b) => {
    const aCritico = a.status_energia === "sem_energia" ? 0 : 1;
    const bCritico = b.status_energia === "sem_energia" ? 0 : 1;
    return aCritico - bCritico;
  });

  listaContainer.innerHTML = ordenados.map(poste => {
    const semEnergia = poste.status_energia === "sem_energia";
    const classeItem = semEnergia ? "status-ativa" : "status-resolvida";
    const classeDot = semEnergia ? "red" : "blue";
    const classeBadge = semEnergia ? "ativa" : "resolvida";
    const textoBadge = semEnergia ? "ativa" : "normal";

    return `
      <div class="cidade-item ${classeItem}" data-lat="${poste.latitude}" data-lng="${poste.longitude}" style="cursor: pointer;">
        <div class="cidade-info">
          <span class="indicator-dot ${classeDot}"></span>
          <span class="cidade-nome">Juazeiro do Norte • ${poste.bairro || poste.codigo_poste}</span>
          <span class="cidade-tempo">${poste.codigo_poste}</span>
        </div>
        <span class="badge-status ${classeBadge}">${textoBadge}</span>
      </div>
    `;
  }).join("");

  // Ao clicar em qualquer item da lista, centraliza o mapa no poste correspondente
  listaContainer.querySelectorAll(".cidade-item").forEach(item => {
    item.addEventListener("click", () => {
      const lat = parseFloat(item.getAttribute("data-lat"));
      const lng = parseFloat(item.getAttribute("data-lng"));
      if (mapa && !isNaN(lat) && !isNaN(lng)) {
        mapa.flyTo([lat, lng], 16, { duration: 1.0 });
      }
    });
  });
}

// 5. ATUALIZA OS BADGES DA BARRA LATERAL COM A CONTAGEM REAL DE ALERTAS ATIVOS
function atualizarBadgesSidebar(postes) {
  const qtdAtivos = postes.filter(p => p.status_energia === "sem_energia").length;
  document.querySelectorAll(".sidebar-menu .badge").forEach(badge => {
    badge.textContent = qtdAtivos;
    badge.style.display = qtdAtivos > 0 ? "inline-flex" : "none";
  });
}

// 6. BARRA DE BUSCA DE POSTES
function configurarBuscaPostes() {
  const inputPoste = document.getElementById("input-poste");
  const btnBuscar = document.querySelector(".search-button");
  const searchContainer = document.querySelector(".search-container");

  if (!searchContainer) return;

  const resultadoBox = document.createElement("div");
  resultadoBox.id = "resultado-busca-poste";
  resultadoBox.style.cssText = `
    display: none;
    margin-top: 12px;
    background-color: #111A2C;
    border: 1px solid #2EB4AF;
    border-radius: 10px;
    padding: 16px;
    color: #ffffff;
  `;
  searchContainer.appendChild(resultadoBox);

  async function pesquisarPoste() {
    const termo = inputPoste.value.trim();
    if (!termo) {
      resultadoBox.style.display = "none";
      return;
    }

    try {
      const resposta = await fetch(`${API_URL}/postes/buscar?q=${encodeURIComponent(termo)}`);
      const postes = await resposta.json();

      resultadoBox.style.display = "block";

      if (postes.length === 0) {
        resultadoBox.innerHTML = `<p style="color: #94A3B8; font-size: 13px;">Nenhum poste encontrado com "${termo}".</p>`;
        return;
      }

      resultadoBox.innerHTML = postes.map(poste => {
        const semEnergia = poste.status_energia === "sem_energia";
        const corStatus = semEnergia ? "#EF4444" : "#2EB4AF";
        const textoStatus = semEnergia ? "SEM ENERGIA (CRÍTICO)" : "ENERGIA NORMAL";

        return `
          <div onclick="window.location.href='consulta_poste.html?codigo=${encodeURIComponent(poste.codigo_poste)}'" 
               style="display: flex; justify-content: space-between; align-items: center; padding: 10px 8px; border-bottom: 1px solid #1E293B; cursor: pointer; transition: background 0.2s;"
               onmouseover="this.style.background='#1E293B'" 
               onmouseout="this.style.background='transparent'">
            <div>
              <strong style="font-size: 15px; color: #2EB4AF;">${poste.codigo_poste}</strong> — <span>${poste.endereco} (${poste.bairro})</span>
              <p style="font-size: 12px; color: #94A3B8; margin-top: 4px;">
                Trecho: <strong>${poste.trecho_afetado || "N/A"}</strong> • Clientes afetados: <strong>${poste.clientes_afetados || 0}</strong>
              </p>
            </div>
            <span style="background: rgba(255,255,255,0.05); border: 1px solid ${corStatus}; color: ${corStatus}; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: bold;">
              ${textoStatus}
            </span>
          </div>
        `;
      }).join("");
    } catch (erro) {
      resultadoBox.style.display = "block";
      resultadoBox.innerHTML = `<p style="color: #EF4444; font-size: 13px;">Erro ao conectar na API Python. Verifique se o servidor está rodando.</p>`;
    }
  }

  if (btnBuscar) btnBuscar.addEventListener("click", pesquisarPoste);
  if (inputPoste) {
    inputPoste.addEventListener("keypress", (e) => {
      if (e.key === "Enter") pesquisarPoste();
    });
  }
}