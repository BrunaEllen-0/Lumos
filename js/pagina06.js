const API_URL = "http://127.0.0.1:8000/api";
let mapaEquipes;
let camadaEquipes;

document.addEventListener("DOMContentLoaded", () => {
  inicializarMapaEquipes();
  carregarDadosNoMapaEquipes();
  iniciarRelogioSincronizacao();
  configurarSelecaoEquipa();
  configurarSelecaoPrioridade();
  configurarBotoesAcao();
});

// 1. INICIALIZA O MAPA CLARO ESRI (Sem API Key)
function inicializarMapaEquipes() {
  const mapEl = document.getElementById("map-equipes");
  if (!mapEl) return;

  mapaEquipes = L.map("map-equipes").setView([-7.2143, -39.3129], 14);

  // Mapa claro oficial Esri (World Street Map - detalhado e sem API Key)
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 18
  }).addTo(mapaEquipes);

  camadaEquipes = L.layerGroup().addTo(mapaEquipes);
}

// 2. CARREGA POSTES CRÍTICOS E EQUIPES DE CAMPO DA API
async function carregarDadosNoMapaEquipes() {
  if (!mapaEquipes) return;
  camadaEquipes.clearLayers();

  try {
    const [resPostes, resEquipes] = await Promise.all([
      fetch(`${API_URL}/postes`),
      fetch(`${API_URL}/equipes`)
    ]);

    const postes = await resPostes.json();
    const equipes = await resEquipes.json();

    // A) Desenha apenas os postes SEM ENERGIA (vermelhos)
    postes.forEach(poste => {
      if (!poste.latitude || !poste.longitude || poste.status_energia !== "SEM_ENERGIA") return;

      const iconePoste = L.divIcon({
        className: "custom-div-icon",
        html: `<div style="width: 18px; height: 18px; border-radius: 50%; background: #EF4444; border: 3px solid #fff; box-shadow: 0 0 12px #EF4444;"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });

      L.marker([poste.latitude, poste.longitude], { icon: iconePoste })
        .bindPopup(`
          <div style="font-family: sans-serif;">
            <strong style="color: #EF4444;">⚠️ ${poste.codigo} (Sem Energia)</strong><br>
            <span style="font-size: 12px; color: #334155;">${poste.endereco} - ${poste.bairro}</span><br>
            <span style="font-size: 11px; color: #64748B;">Clientes afetados: <strong>${poste.clientes_afetados || 0}</strong></span>
          </div>
        `)
        .addTo(camadaEquipes);
    });

    // B) Desenha as EQUIPES DE CAMPO (Verde = Disponível | Amarelo = Ocupada)
    equipes.forEach(equipe => {
      if (!equipe.latitude || !equipe.longitude) return;

      const disponivel = equipe.status === "Disponível";
      const corEquipe = disponivel ? "#10B981" : "#F59E0B";

      const iconeEquipe = L.divIcon({
        className: "custom-div-icon",
        html: `<div style="width: 22px; height: 22px; border-radius: 6px; background: ${corEquipe}; border: 2px solid #fff; box-shadow: 0 0 12px ${corEquipe}; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; font-size: 11px;">E</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      L.marker([equipe.latitude, equipe.longitude], { icon: iconeEquipe })
        .bindPopup(`
          <div style="font-family: sans-serif; min-width: 170px;">
            <strong style="color: #0F172A;">🚐 ${equipe.nome}</strong><br>
            <span style="font-size: 12px; font-weight: bold; color: ${corEquipe};">Status: ${equipe.status}</span><br>
            <span style="font-size: 11px; color: #475569;">${equipe.especialidade || "Manutenção de Rede"}</span>
          </div>
        `)
        .addTo(camadaEquipes);
    });
 } catch (erro) {
    console.warn("Usando coordenada de exemplo (MySQL offline):", erro);

    // Pino do Poste PST-0442 na coordenada exata
    const iconePoste = L.divIcon({
      className: "custom-div-icon",
      html: `<div style="width: 18px; height: 18px; border-radius: 50%; background: #EF4444; border: 3px solid #fff; box-shadow: 0 0 12px #EF4444;"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    L.marker([-7.227694, -39.312074], { icon: iconePoste })
      .bindPopup(`
        <div style="font-family: sans-serif;">
          <strong style="color: #EF4444;">⚠️ PST-0442 (Sem Energia)</strong><br>
          <span style="font-size: 12px; color: #334155;">Av. Aílton Gomes</span><br>
          <span style="font-size: 11px; color: #64748B;">Clientes afetados: <strong>1.436</strong></span>
        </div>
      `)
      .addTo(camadaEquipes)
      .openPopup();
  }
}

// 3. RELÓGIO DE SINCRONIZAÇÃO NO TOPO
function iniciarRelogioSincronizacao() {
  const syncTimeElement = document.querySelector(".sync-time");

  function atualizarHorario() {
    const agora = new Date();
    const horas = String(agora.getHours()).padStart(2, "0");
    const minutos = String(agora.getMinutes()).padStart(2, "0");
    const segundos = String(agora.getSeconds()).padStart(2, "0");

    if (syncTimeElement) {
      syncTimeElement.textContent = `${horas}:${minutos}:${segundos}`;
    }
  }

  atualizarHorario();
  setInterval(atualizarHorario, 1000);
}

// 4. SELEÇÃO DE EQUIPE E PRIORIDADE
function configurarSelecaoEquipa() {
  const opcoesEquipa = document.querySelectorAll(".team-option");

  opcoesEquipa.forEach((opcao) => {
    opcao.addEventListener("click", () => {
      if (opcao.classList.contains("disabled")) return;

      opcoesEquipa.forEach((opt) => opt.classList.remove("active"));
      opcao.classList.add("active");

      const radioInput = opcao.querySelector('input[type="radio"]');
      if (radioInput) {
        radioInput.checked = true;
      }
    });
  });
}

function configurarSelecaoPrioridade() {
  const botoesPrioridade = document.querySelectorAll(".priority-btn");

  botoesPrioridade.forEach((botao) => {
    botao.addEventListener("click", () => {
      botoesPrioridade.forEach((btn) => btn.classList.remove("active-critica", "active"));

      const textoPrioridade = botao.textContent.trim().toUpperCase();
      if (textoPrioridade === "CRÍTICA") {
        botao.classList.add("active-critica");
      } else {
        botao.classList.add("active");
      }
    });
  });
}

// 5. BOTÕES DE CONFIRMAR ACIONAMENTO E CANCELAR
function configurarBotoesAcao() {
  const btnConfirmar = document.querySelector(".btn-confirm");
  const btnCancelar = document.querySelector(".btn-cancel");

  if (btnConfirmar) {
    btnConfirmar.addEventListener("click", () => {
      const equipaAtiva = document.querySelector(".team-option.active");

      if (equipaAtiva) {
        const tituloElemento = equipaAtiva.querySelector(".team-details h3");
        const descricaoElemento = equipaAtiva.querySelector(".team-details p");
        const distVal = equipaAtiva.querySelector(".dist-val");
        const distTime = equipaAtiva.querySelector(".dist-time");

        const nomeEquipa = tituloElemento ? tituloElemento.textContent.trim() : "Equipe selecionada";
        let composicao = descricaoElemento ? descricaoElemento.textContent.trim() : "";
        composicao = composicao.replace(/Disponível/g, "").replace(/•\s*$/, "").trim();

        const distTexto = distVal ? distVal.textContent.trim() : "";
        const tempoTexto = distTime ? distTime.textContent.trim() : "";
        const distanciaFinal = `${distTexto} — ${tempoTexto}`;

        const agora = new Date();
        const horaAtual = agora.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        const elNome = document.getElementById("modal-nome-equipe");
        const elResumo = document.getElementById("modal-equipe-resumo");
        const elComposicao = document.getElementById("modal-composicao");
        const elDistancia = document.getElementById("modal-distancia");
        const elHora = document.getElementById("modal-hora");

        if (elNome) elNome.textContent = nomeEquipa;
        if (elResumo) elResumo.textContent = nomeEquipa;
        if (elComposicao) elComposicao.textContent = composicao;
        if (elDistancia) elDistancia.textContent = distanciaFinal;
        if (elHora) elHora.textContent = horaAtual;
      }

      const modal = document.getElementById("modal-sucesso");
      if (modal) {
        modal.classList.remove("hidden");
      }
    });
  }

  if (btnCancelar) {
    btnCancelar.addEventListener("click", () => {
      if (confirm("Deseja cancelar o acionamento da equipe?")) {
        window.location.href = "pagina04.html";
      }
    });
  }
}

function fecharModal() {
  const modal = document.getElementById("modal-sucesso");
  if (modal) {
    modal.classList.add("hidden");
  }
}

function irParaAlertas() {
  window.location.href = "pagina04.html";
}
// 1. Centraliza o mapa exatamente na coordenada do poste
function inicializarMapaEquipes() {
  const mapEl = document.getElementById("map-equipes");
  if (!mapEl) return;

  mapaEquipes = L.map("map-equipes").setView([-7.227694, -39.312074], 16);

  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 18
  }).addTo(mapaEquipes);

  camadaEquipes = L.layerGroup().addTo(mapaEquipes);
}