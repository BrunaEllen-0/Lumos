const API_URL = "http://127.0.0.1:8000/api";
let mapa;
let camadaMarcadores;
let marcadoresPorCodigo = {};
let posteSelecionadoCodigo = null;

document.addEventListener("DOMContentLoaded", () => {
  inicializarMapa();
  carregarPostes();
  configurarBuscaPostes();

  // Atualiza automaticamente a cada 5 segundos se não houver filtro digitado
  setInterval(() => {
    const termo = document.getElementById("input-poste")?.value.trim();
    if (!termo) {
      carregarPostes(true);
    }
  }, 5000);
});

// 1. INICIALIZA O MAPA LEAFLET
function inicializarMapa() {
  const mapEl = document.getElementById("map");
  if (!mapEl) return;

  mapa = L.map("map").setView([-7.2143, -39.3150], 14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(mapa);

  camadaMarcadores = L.layerGroup().addTo(mapa);
}

// 2. BUSCA TODOS OS POSTES NA API
async function carregarPostes(silencioso = false) {
  try {
    const res = await fetch(`${API_URL}/postes`);
    const postes = await res.json();

    // Verifica se veio algum ?codigo=... pela URL ao clicar na pagina01.html
    const params = new URLSearchParams(window.location.search);
    const codigoDaUrl = params.get("codigo");
    if (codigoDaUrl && !posteSelecionadoCodigo) {
      posteSelecionadoCodigo = codigoDaUrl;
    }

    renderizarMapaELista(postes, !silencioso);

    const statusTime = document.getElementById("status-atualizacao");
    if (statusTime) statusTime.textContent = "ATUALIZADO AGORA";
  } catch (erro) {
    console.error("Erro ao carregar postes da API:", erro);
    const painel = document.getElementById("painel-detalhes-poste");
    if (painel && !silencioso) {
      painel.innerHTML = `<p class="texto-vazio" style="color:#EF4444;">Erro ao conectar na API (verifique se o FastAPI está rodando).</p>`;
    }
  }
}

// 3. DESENHA PINOS NO MAPA E PREENCHE O PAINEL DA DIREITA
function renderizarMapaELista(postes, ajustarZoom = true) {
  if (!mapa) return;

  camadaMarcadores.clearLayers();
  marcadoresPorCodigo = {};

  const contador = document.getElementById("contador-postes");
  if (contador) {
    contador.textContent = `${postes.length} POSTE(S)`;
  }

  postes.forEach((poste) => {
    if (!poste.latitude || !poste.longitude) return;

    const emAlerta = poste.status_energia === "sem_energia";
    const corPino = emAlerta ? "#EF4444" : "#2EB4AF";
    const textoStatus = emAlerta ? "EM ALERTA" : "NORMAL";

    const iconeCustom = L.divIcon({
      className: "custom-div-icon",
      html: `<div style="width: 18px; height: 18px; border-radius: 50%; background: ${corPino}; border: 3px solid #fff; box-shadow: 0 0 12px ${corPino};"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    const marker = L.marker([poste.latitude, poste.longitude], { icon: iconeCustom });

    marker.bindPopup(`
      <div style="font-family: Arial, sans-serif; min-width: 190px;">
        <strong style="font-size: 14px; color: #0F172A;">${poste.codigo_poste}</strong><br>
        <span style="font-size: 12px; color: #475569;">${poste.endereco || "-"} - ${poste.bairro || "-"}</span>
        <hr style="margin: 6px 0; border: 0; border-top: 1px solid #E2E8F0;">
        <span style="font-size: 11px; font-weight: bold; color: ${corPino};">STATUS: ${textoStatus}</span><br>
        <span style="font-size: 11px; color: #334155;">Lat: ${poste.latitude} | Lon: ${poste.longitude}</span>
      </div>
    `);

    marker.on("click", () => {
      exibirDetalhesPoste(poste);
    });

    marker.addTo(camadaMarcadores);
    marcadoresPorCodigo[poste.codigo_poste] = marker;
  });

  // Se houver apenas 1 poste na busca, já exibe os detalhes completos e centraliza nele
  if (postes.length === 1) {
    exibirDetalhesPoste(postes[0], ajustarZoom);
  } else if (posteSelecionadoCodigo) {
    const posteAtualizado = postes.find((p) => p.codigo_poste === posteSelecionadoCodigo);
    if (posteAtualizado) {
      exibirDetalhesPoste(posteAtualizado, false);
    } else {
      exibirListaPostes(postes);
    }
  } else {
    exibirListaPostes(postes);
  }
}

// 4. EXIBE OS DETALHES COMPLETOS DE UM POSTE NO CARD DA DIREITA
function exibirDetalhesPoste(poste, centralizarMapa = true) {
  posteSelecionadoCodigo = poste.codigo_poste;
  const painel = document.getElementById("painel-detalhes-poste");
  if (!painel) return;

  const emAlerta = poste.status_energia === "sem_energia";
  const classeCard = emAlerta ? "em-alerta" : "";
  const classeBadge = emAlerta ? "alerta" : "normal";
  const textoStatus = emAlerta ? "EM ALERTA (SEM ENERGIA)" : "NORMAL";

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

      <button type="button" id="btn-voltar-lista" class="clear-button" style="width: 100%; margin-top: 6px;">
        Ver todos os postes cadastrados
      </button>
    </div>
  `;

  document.getElementById("btn-voltar-lista").addEventListener("click", () => {
    posteSelecionadoCodigo = null;
    document.getElementById("input-poste").value = "";
    carregarPostes(true);
    mapa.setView([-7.2143, -39.3150], 14);
  });

  if (centralizarMapa && mapa && poste.latitude && poste.longitude) {
    mapa.flyTo([poste.latitude, poste.longitude], 17, { duration: 1.0 });
    const marker = marcadoresPorCodigo[poste.codigo_poste];
    if (marker) marker.openPopup();
  }
}

// 5. EXIBE A LISTA CLICÁVEL DE POSTES QUANDO NENHUM ESTÁ SELECIONADO
function exibirListaPostes(postes) {
  const painel = document.getElementById("painel-detalhes-poste");
  if (!painel) return;

  if (postes.length === 0) {
    painel.innerHTML = `<p class="texto-vazio">Nenhum poste encontrado para essa pesquisa.</p>`;
    return;
  }

  painel.innerHTML = postes
    .map((poste) => {
      const emAlerta = poste.status_energia === "sem_energia";
      const statusClasse = emAlerta ? "status-ativa" : "";
      const dotClasse = emAlerta ? "red" : "blue";
      const badgeClasse = emAlerta ? "alerta" : "normal";
      const textoBadge = emAlerta ? "em alerta" : "normal";

      return `
        <div class="cidade-item item-clicavel ${statusClasse}" data-codigo="${poste.codigo_poste}">
          <div class="cidade-info">
            <span class="indicator-dot ${dotClasse}" style="${!emAlerta ? 'background-color:#2EB4AF;' : ''}"></span>
            <div>
              <span class="cidade-nome">${poste.codigo_poste}</span>
              <span class="cidade-tempo">${poste.endereco || ""} - ${poste.bairro || ""}</span>
            </div>
          </div>
          <span class="badge-status ${badgeClasse}">${textoBadge}</span>
        </div>
      `;
    })
    .join("");

  // Adiciona clique em cada item da lista
  painel.querySelectorAll(".item-clicavel").forEach((item) => {
    item.addEventListener("click", () => {
      const codigo = item.getAttribute("data-codigo");
      const posteEncontrado = postes.find((p) => p.codigo_poste === codigo);
      if (posteEncontrado) {
        exibirDetalhesPoste(posteEncontrado, true);
      }
    });
  });
}

// 6. CONFIGURA A BARRA DE PESQUISA
function configurarBuscaPostes() {
  const inputPoste = document.getElementById("input-poste");
  const btnBuscar = document.getElementById("btn-buscar");
  const btnLimpar = document.getElementById("btn-limpar");

  async function pesquisarPoste() {
    const termo = inputPoste.value.trim();
    if (!termo) {
      posteSelecionadoCodigo = null;
      carregarPostes(false);
      return;
    }

    try {
      const resposta = await fetch(`${API_URL}/postes/buscar?q=${encodeURIComponent(termo)}`);
      const postes = await resposta.json();
      posteSelecionadoCodigo = null;
      renderizarMapaELista(postes, true);
    } catch (erro) {
      console.error("Erro na busca:", erro);
    }
  }

  if (btnBuscar) btnBuscar.addEventListener("click", pesquisarPoste);
  if (inputPoste) {
    inputPoste.addEventListener("keypress", (e) => {
      if (e.key === "Enter") pesquisarPoste();
    });
  }
  if (btnLimpar) {
    btnLimpar.addEventListener("click", () => {
      inputPoste.value = "";
      posteSelecionadoCodigo = null;
      carregarPostes(false);
      if (mapa) mapa.setView([-7.2143, -39.3150], 14);
    });
  }
}