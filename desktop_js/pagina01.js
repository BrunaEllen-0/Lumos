const API_URL = "http://127.0.0.1:8000/api";
let mapa;
let camadaMarcadores;

document.addEventListener("DOMContentLoaded", () => {
  inicializarMapa();
  carregarPostesNoMapa();
  configurarBuscaPostes();
});

// 1. INICIALIZA O MAPA LEAFLET (Foco em Juazeiro do Norte - CE)
function inicializarMapa() {
  const mapEl = document.getElementById("map");
  if (!mapEl) return;

  mapa = L.map("map").setView([-7.2143, -39.3129], 14);

  // Servidor oficial OpenStreetMap (100% gratuito e sem necessidade de API Key)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(mapa);

  camadaMarcadores = L.layerGroup().addTo(mapa);
}
// 2. BUSCA OS POSTES NA API E DESENHA OS PINOS
async function carregarPostesNoMapa() {
  if (!mapa) return;

  try {
    const res = await fetch(`${API_URL}/postes`);
    const postes = await res.json();

    camadaMarcadores.clearLayers();

    postes.forEach(poste => {
      if (!poste.latitude || !poste.longitude) return;

      const semEnergia = poste.status_energia === "SEM_ENERGIA";
      const classePino = semEnergia ? "marker-active" : "marker-resolved";
      const corBadge = semEnergia ? "#EF4444" : "#2EB4AF";
      const textoStatus = semEnergia ? "SEM ENERGIA (CRÍTICO)" : "ENERGIA NORMAL";

      // Cria o ícone customizado usando as classes do seu pagina01.css
      const iconeCustom = L.divIcon({
        className: "custom-div-icon",
        html: `<div class="${classePino}" style="width: 18px; height: 18px; border-radius: 50%; background: ${corBadge}; border: 3px solid #fff; box-shadow: 0 0 12px ${corBadge};"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });

      const marker = L.marker([poste.latitude, poste.longitude], { icon: iconeCustom });

      // Balão de informações ao clicar no pino
      marker.bindPopup(`
        <div style="font-family: sans-serif; min-width: 180px;">
          <strong style="font-size: 14px; color: #0F172A;">${poste.codigo}</strong><br>
          <span style="font-size: 12px; color: #475569;">${poste.endereco} - ${poste.bairro}</span>
          <hr style="margin: 6px 0; border: 0; border-top: 1px solid #E2E8F0;">
          <span style="font-size: 11px; font-weight: bold; color: ${corBadge};">${textoStatus}</span><br>
          <span style="font-size: 11px; color: #334155;">Clientes afetados: <strong>${poste.clientes_afetados || 0}</strong></span>
        </div>
      `);

      marker.addTo(camadaMarcadores);
    });
  } catch (erro) {
    console.warn("Não foi possível carregar os postes no mapa (verifique API/MySQL):", erro);
  }
}

// 3. BARRA DE BUSCA DE POSTES
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
        const semEnergia = poste.status_energia === "SEM_ENERGIA";
        const corStatus = semEnergia ? "#EF4444" : "#2EB4AF";
        const textoStatus = semEnergia ? "SEM ENERGIA (CRÍTICO)" : "ENERGIA NORMAL";

        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #1E293B;">
            <div>
              <strong style="font-size: 15px; color: #2EB4AF;">${poste.codigo}</strong> — <span>${poste.endereco} (${poste.bairro})</span>
              <p style="font-size: 12px; color: #94A3B8; margin-top: 4px;">
                Trecho: <strong>${poste.trecho_afetado || "N/A"}</strong> • Clientes afetados: <strong>${poste.clientes_afetados}</strong>
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