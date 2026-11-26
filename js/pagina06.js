const API_URL = "http://127.0.0.1:8000/api";
let mapaEquipes;
let camadaEquipes;
let posteAtual = null;
let ocorrenciaAtual = null;

document.addEventListener("DOMContentLoaded", async () => {
  inicializarMapaEquipes();
  iniciarRelogioSincronizacao();
  configurarSelecaoEquipa();
  configurarSelecaoPrioridade();
  configurarBotoesAcao();

  await carregarDadosOcorrenciaEMapa();
});

// 1. INICIALIZA O MAPA LEAFLET (#map-equipes)
function inicializarMapaEquipes() {
  const mapEl = document.getElementById("map-equipes");
  if (!mapEl) return;

  mapaEquipes = L.map("map-equipes").setView([-7.2143, -39.3129], 15);

  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri",
    maxZoom: 18
  }).addTo(mapaEquipes);

  camadaEquipes = L.layerGroup().addTo(mapaEquipes);
}

// 2. CARREGA DADOS DO POSTE SELECIONADO (VIA ?poste=...) E EQUIPES NO MAPA
async function carregarDadosOcorrenciaEMapa() {
  const params = new URLSearchParams(window.location.search);
  const codigoPosteUrl = params.get("poste");

  try {
    const [resPostes, resOcorrencias, resEquipes] = await Promise.all([
      fetch(`${API_URL}/postes`),
      fetch(`${API_URL}/ocorrencias`),
      fetch(`${API_URL}/equipes`)
    ]);

    const postes = await resPostes.json();
    const ocorrencias = await resOcorrencias.json();
    const equipes = await resEquipes.json();

    // Seleciona o poste vindo da URL ou o primeiro poste em alerta
    posteAtual = codigoPosteUrl
      ? postes.find(p => p.codigo_poste === codigoPosteUrl)
      : postes.find(p => p.status_energia === "sem_energia") || postes[0];

    // Busca a ocorrência aberta correspondente a esse poste
    if (posteAtual) {
      ocorrenciaAtual = ocorrencias.find(
        o => o.codigo_poste === posteAtual.codigo_poste && o.status_alerta !== "resolvida"
      ) || ocorrencias.find(o => o.codigo_poste === posteAtual.codigo_poste);

      atualizarInterfaceComPoste(posteAtual, ocorrenciaAtual);
    }

    // Desenha os pinos no mini-mapa
    if (mapaEquipes && camadaEquipes) {
      camadaEquipes.clearLayers();

      // Pino do poste da ocorrência em foco
      if (posteAtual && posteAtual.latitude && posteAtual.longitude) {
        const lat = parseFloat(posteAtual.latitude);
        const lng = parseFloat(posteAtual.longitude);

        mapaEquipes.setView([lat, lng], 16);

        const iconePoste = L.divIcon({
          className: "custom-div-icon",
          html: `<div style="width: 20px; height: 20px; border-radius: 50%; background: #EF4444; border: 3px solid #fff; box-shadow: 0 0 14px #EF4444;"></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });

        L.marker([lat, lng], { icon: iconePoste })
          .bindPopup(`
            <div style="font-family: sans-serif;">
              <strong style="color: #EF4444;">⚠️ ${posteAtual.codigo_poste} (Sem Energia)</strong><br>
              <span style="font-size: 12px; color: #334155;">${posteAtual.endereco} - ${posteAtual.bairro}</span><br>
              <span style="font-size: 11px; color: #64748B;">Clientes afetados: <strong>${posteAtual.clientes_afetados || 0}</strong></span>
            </div>
          `)
          .addTo(camadaEquipes)
          .openPopup();
      }

      // Pinos das equipes de campo
      equipes.forEach(equipe => {
        if (!equipe.latitude || !equipe.longitude) return;

        const disponivel = equipe.status && equipe.status.toLowerCase().includes("disp");
        const corEquipe = disponivel ? "#10B981" : "#F59E0B";

        const iconeEquipe = L.divIcon({
          className: "custom-div-icon",
          html: `<div style="width: 22px; height: 22px; border-radius: 6px; background: ${corEquipe}; border: 2px solid #fff; box-shadow: 0 0 12px ${corEquipe}; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; font-size: 11px;">E</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });

        L.marker([parseFloat(equipe.latitude), parseFloat(equipe.longitude)], { icon: iconeEquipe })
          .bindPopup(`
            <div style="font-family: sans-serif; min-width: 160px;">
              <strong style="color: #0F172A;">🚐 ${equipe.nome}</strong><br>
              <span style="font-size: 12px; font-weight: bold; color: ${corEquipe};">Status: ${equipe.status}</span>
            </div>
          `)
          .addTo(camadaEquipes);
      });
    }
  } catch (erro) {
    console.warn("Erro ao carregar dados da API na pagina06:", erro);
  }
}

// 3. ATUALIZA TEXTOS DA PÁGINA COM OS DADOS REAIS DO POSTE
function atualizarInterfaceComPoste(poste, ocorrencia) {
  const lat = parseFloat(poste.latitude);
  const lng = parseFloat(poste.longitude);
  const idOc = ocorrencia ? ocorrencia.id_alerta : "482";

  // Cabeçalho da página
  const subtituloHeader = document.querySelector(".header-left p");
  if (subtituloHeader) {
    subtituloHeader.textContent = `Despacho de equipe para a ocorrência #${idOc} — ${poste.bairro || "Juazeiro do Norte"}, CE`;
  }

  // Subtítulo do card "Local da ocorrência"
  const subtituloCardLocal = document.querySelector(".right-col .content-card:first-child .card-subtitle");
  if (subtituloCardLocal) {
    subtituloCardLocal.textContent = `POSTE ${poste.codigo_poste}`;
  }

  // Linhas de Endereço, Trecho afetado e Clientes afetados
  const linhasDetalhes = document.querySelectorAll(".location-details .detail-row");
  linhasDetalhes.forEach(linha => {
    const label = linha.querySelector(".detail-label");
    const value = linha.querySelector(".detail-value");
    if (!label || !value) return;

    const textoLabel = label.textContent.trim();
    if (textoLabel === "Endereço") {
      value.textContent = `${poste.endereco} (${lat.toFixed(6)}, ${lng.toFixed(6)})`;
    } else if (textoLabel === "Trecho afetado") {
      value.textContent = poste.trecho_afetado || poste.codigo_poste;
    } else if (textoLabel === "Clientes afetados") {
      value.textContent = poste.clientes_afetados ?? 0;
    }
  });

  // Textarea de instruções para a equipe
  const textareaInstrucoes = document.querySelector(".instructions-textarea");
  if (textareaInstrucoes) {
    textareaInstrucoes.value =
      `Proceder à inspeção da rede e chaves fusíveis no ${poste.trecho_afetado || "trecho"} (${poste.codigo_poste} — ${poste.endereco}, ${poste.bairro}).\n` +
      `Realizar testes de tensão e continuidade antes de reenergizar o ramal.\n` +
      `Confirmar o restabelecimento junto ao Centro de Operação.`;
  }

  // Descrição do modal de sucesso
  const modalDesc = document.querySelector(".modal-description");
  if (modalDesc) {
    modalDesc.innerHTML = `A <strong id="modal-nome-equipe">Equipe ENL-07 • Carlos M.</strong> foi acionada para a ocorrência <strong>#${idOc}</strong> (${poste.codigo_poste}) e já recebeu o chamado no app do agente técnico.`;
  }
}

// 4. RELÓGIO DE SINCRONIZAÇÃO NO TOPO
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

// 5. SELEÇÃO DE EQUIPE E PRIORIDADE
function configurarSelecaoEquipa() {
  const opcoesEquipa = document.querySelectorAll(".team-option");

  opcoesEquipa.forEach((opcao) => {
    opcao.addEventListener("click", () => {
      if (opcao.classList.contains("disabled")) return;

      opcoesEquipa.forEach((opt) => opt.classList.remove("active"));
      opcao.classList.add("active");

      const radioInput = opcao.querySelector('input[type="radio"]');
      if (radioInput) radioInput.checked = true;
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

// 6. BOTÕES DE CONFIRMAR ACIONAMENTO E CANCELAR
function configurarBotoesAcao() {
  const btnConfirmar = document.querySelector(".btn-confirm");
  const btnCancelar = document.querySelector(".btn-cancel");

  if (btnConfirmar) {
    btnConfirmar.addEventListener("click", async () => {
      const equipaAtiva = document.querySelector(".team-option.active");
      const prioridadeAtiva = document.querySelector(".priority-btn.active-critica, .priority-btn.active");
      const textareaInstrucoes = document.querySelector(".instructions-textarea");

      let nomeEquipa = "Equipe selecionada";
      let idEquipe = 1;

      if (equipaAtiva) {
        const tituloElemento = equipaAtiva.querySelector(".team-details h3");
        const descricaoElemento = equipaAtiva.querySelector(".team-details p");
        const badgeElemento = equipaAtiva.querySelector(".team-badge");
        const distVal = equipaAtiva.querySelector(".dist-val");
        const distTime = equipaAtiva.querySelector(".dist-time");

        nomeEquipa = tituloElemento ? tituloElemento.textContent.trim() : nomeEquipa;
        if (badgeElemento && badgeElemento.textContent.trim() === "12") idEquipe = 2;

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

      // Envia o acionamento real para o FastAPI se houver ocorrência vinculada
      if (ocorrenciaAtual && ocorrenciaAtual.id_alerta) {
        try {
          await fetch(`${API_URL}/acionamentos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id_ocorrencia: ocorrenciaAtual.id_alerta,
              id_equipe: idEquipe,
              prioridade: prioridadeAtiva ? prioridadeAtiva.textContent.trim() : "CRÍTICA",
              instrucoes: textareaInstrucoes ? textareaInstrucoes.value : ""
            })
          });
        } catch (e) {
          console.warn("Não foi possível gravar ordem de serviço no banco:", e);
        }
      }

      const modal = document.getElementById("modal-sucesso");
      if (modal) modal.classList.remove("hidden");
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
  if (modal) modal.classList.add("hidden");
}

function irParaAlertas() {
  window.location.href = "pagina04.html";
}