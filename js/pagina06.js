const API_BASE = "http://127.0.0.1:8000/api";

let mapaPoste = null;
let marcadorPoste = null;
let equipesCarregadas = [];
let equipeSelecionada = null;
let prioridadeSelecionada = "critica";
let ocorrenciaAtual = null;

function obterIdOcorrenciaUrl() {
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get("id_ocorrencia") || params.get("id_alerta") || params.get("id");
  return idParam ? Number(idParam) : null;
}

function atualizarHoraSincronizacao() {
  const el = document.getElementById("sync-time");
  if (!el) return;
  const agora = new Date();
  el.textContent = agora.toLocaleTimeString("pt-BR");
}

function renderizarMapa(lat, lng, codigoPoste, endereco) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return;

  if (!mapaPoste) {
    mapaPoste = L.map("map-equipes").setView([latitude, longitude], 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
    }).addTo(mapaPoste);
  } else {
    mapaPoste.setView([latitude, longitude], 16);
  }

  if (marcadorPoste) {
    marcadorPoste.setLatLng([latitude, longitude]);
  } else {
    marcadorPoste = L.marker([latitude, longitude]).addTo(mapaPoste);
  }

  marcadorPoste.bindPopup(`<b>${codigoPoste || "Poste"}</b><br>${endereco || ""}`).openPopup();
}

function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) {
    return null;
  }
  const R = 6371;
  const dLat = ((Number(lat2) - Number(lat1)) * Math.PI) / 180;
  const dLon = ((Number(lon2) - Number(lon1)) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((Number(lat1) * Math.PI) / 180) *
      Math.cos((Number(lat2) * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function carregarOcorrencia() {
  let idOcorrencia = obterIdOcorrenciaUrl();

  if (!idOcorrencia) {
    const respLista = await fetch(`${API_BASE}/ocorrencias`);
    if (respLista.ok) {
      const lista = await respLista.json();
      const ativa = lista.find((o) => o.status_alerta !== "resolvido") || lista[0];
      if (ativa) idOcorrencia = ativa.id_alerta ?? ativa.id;
    }
  }

  if (!idOcorrencia) return;

  const resp = await fetch(`${API_BASE}/ocorrencias/${idOcorrencia}`);
  if (!resp.ok) return;

  ocorrenciaAtual = await resp.json();

  document.getElementById("subtitulo-ocorrencia").textContent =
    `Despacho de equipe para a ocorrência #${ocorrenciaAtual.id_alerta} — ${ocorrenciaAtual.bairro || "Juazeiro do Norte"}, CE`;

  document.getElementById("banner-descricao").textContent =
    ocorrenciaAtual.descricao || "Interrupção súbita de tensão e corrente elétrica no trecho monitorado";

  document.getElementById("codigo-poste-label").textContent =
    `POSTE ${ocorrenciaAtual.codigo_poste || ""}`;

  const coordsTexto =
    ocorrenciaAtual.latitude != null && ocorrenciaAtual.longitude != null
      ? ` (${Number(ocorrenciaAtual.latitude).toFixed(6)}, ${Number(ocorrenciaAtual.longitude).toFixed(6)})`
      : "";

  document.getElementById("endereco-poste").textContent =
    `${ocorrenciaAtual.endereco || "Endereço não informado"}${coordsTexto}`;

  document.getElementById("trecho-poste").textContent =
    ocorrenciaAtual.trecho_afetado || ocorrenciaAtual.codigo_poste || "—";

  document.getElementById("clientes-poste").textContent =
    Number(ocorrenciaAtual.clientes_afetados || 0).toLocaleString("pt-BR");

  renderizarMapa(
    ocorrenciaAtual.latitude,
    ocorrenciaAtual.longitude,
    ocorrenciaAtual.codigo_poste,
    ocorrenciaAtual.endereco
  );
}

function selecionarEquipe(idEquipe) {
  const equipe = equipesCarregadas.find((eq) => Number(eq.id_equipe ?? eq.id) === Number(idEquipe));
  if (!equipe || String(equipe.status).toLowerCase() !== "disponivel") return;

  equipeSelecionada = equipe;

  document.querySelectorAll("#lista-equipes .team-option").forEach((label) => {
    const eqId = Number(label.dataset.idEquipe);
    label.classList.toggle("active", eqId === Number(idEquipe));
    const radio = label.querySelector('input[type="radio"]');
    if (radio) radio.checked = eqId === Number(idEquipe);
  });
}

async function carregarEquipes() {
  const container = document.getElementById("lista-equipes");
  if (!container) return;

  const resp = await fetch(`${API_BASE}/equipes`);
  if (!resp.ok) throw new Error("Falha ao buscar equipes");

  equipesCarregadas = await resp.json();

  const itemsComDistancia = equipesCarregadas.map((eq) => {
    const distKm = ocorrenciaAtual
      ? calcularDistanciaKm(
          ocorrenciaAtual.latitude,
          ocorrenciaAtual.longitude,
          eq.latitude,
          eq.longitude
        )
      : null;
    return { ...eq, distKm };
  });

  itemsComDistancia.sort((a, b) => {
    const aDisp = String(a.status).toLowerCase() === "disponivel" ? 0 : 1;
    const bDisp = String(b.status).toLowerCase() === "disponivel" ? 0 : 1;
    if (aDisp !== bDisp) return aDisp - bDisp;
    if (a.distKm !== null && b.distKm !== null) return a.distKm - b.distKm;
    return 0;
  });

  const primeiraDisponivel = itemsComDistancia.find(
    (eq) => String(eq.status).toLowerCase() === "disponivel"
  );
  equipeSelecionada = primeiraDisponivel || null;

  container.innerHTML = itemsComDistancia
    .map((eq) => {
      const idEq = eq.id_equipe ?? eq.id;
      const statusLower = String(eq.status || "").toLowerCase();
      const disponivel = statusLower === "disponivel";
      const selecionada = equipeSelecionada && Number(equipeSelecionada.id_equipe ?? equipeSelecionada.id) === Number(idEq);
      const sigla = String(eq.nome || "EQ").slice(-2).toUpperCase();

      const rotuloStatus = disponivel
        ? "Disponível"
        : statusLower === "ocupada"
        ? "Ocupada"
        : "Indisponível";

      const distTexto =
        eq.distKm !== null ? `${eq.distKm.toFixed(1).replace(".", ",")} km` : "—";
      const tempoTexto =
        eq.distKm !== null ? `~${Math.max(3, Math.round((eq.distKm / 30) * 60))} min` : "";

      return `
        <label class="team-option ${selecionada ? "active" : ""} ${!disponivel ? "disabled" : ""}" data-id-equipe="${idEq}">
          <input type="radio" name="equipe" value="${idEq}" ${selecionada ? "checked" : ""} ${!disponivel ? "disabled" : ""}>
          <span class="custom-radio"></span>
          <div class="team-badge">${sigla}</div>
          <div class="team-details">
            <h3>${eq.nome}</h3>
            <p>${eq.composicao || "Equipe de campo"} • ${rotuloStatus}</p>
          </div>
          ${
            disponivel
              ? `<div class="team-distance">
                   <span class="dist-val">${distTexto}</span>
                   <span class="dist-time">${tempoTexto}</span>
                 </div>`
              : `<div class="team-status-tag">${rotuloStatus}</div>`
          }
        </label>
      `;
    })
    .join("");

  container.querySelectorAll(".team-option").forEach((label) => {
    label.addEventListener("click", () => {
      if (label.classList.contains("disabled")) return;
      selecionarEquipe(label.dataset.idEquipe);
    });
  });
}

function configurarPrioridades() {
  const botoes = document.querySelectorAll("#seletor-prioridade .priority-btn");
  botoes.forEach((btn) => {
    btn.addEventListener("click", () => {
      botoes.forEach((b) => b.classList.remove("active-critica"));
      btn.classList.add("active-critica");
      prioridadeSelecionada = btn.dataset.prioridade || "media";
    });
  });
}

async function confirmarAcionamento() {
  if (!ocorrenciaAtual) {
    alert("Nenhuma ocorrência carregada.");
    return;
  }

  if (!equipeSelecionada || String(equipeSelecionada.status).toLowerCase() !== "disponivel") {
    alert("Selecione uma equipe disponível para realizar o despacho.");
    return;
  }

  const instrucoes = document.getElementById("instrucoes-equipe")?.value?.trim() || "";
  const payload = {
    id_ocorrencia: Number(ocorrenciaAtual.id_alerta ?? ocorrenciaAtual.id),
    id_equipe: Number(equipeSelecionada.id_equipe ?? equipeSelecionada.id),
    prioridade: prioridadeSelecionada,
    instrucoes,
  };

  const resp = await fetch(`${API_BASE}/acionamentos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await resp.json();
  if (!resp.ok) {
    alert(data.detail || "Erro ao confirmar acionamento.");
    return;
  }

  document.getElementById("modal-nome-equipe").textContent = equipeSelecionada.nome;
  document.getElementById("modal-id-ocorrencia").textContent = `#${payload.id_ocorrencia}`;
  document.getElementById("modal-equipe-resumo").textContent = equipeSelecionada.nome;
  document.getElementById("modal-composicao").textContent = equipeSelecionada.composicao || "Equipe de campo";
  document.getElementById("modal-prioridade").textContent = prioridadeSelecionada.toUpperCase();
  document.getElementById("modal-distancia").textContent = "Despachada";
  document.getElementById("modal-hora").textContent = new Date().toLocaleTimeString("pt-BR");

  document.getElementById("modal-sucesso").classList.remove("hidden");
  await carregarEquipes();
}

async function finalizarOcorrenciaAtual() {
  if (!ocorrenciaAtual) return;

  const idOcorrencia = Number(ocorrenciaAtual.id_alerta ?? ocorrenciaAtual.id);
  const observacao = document.getElementById("instrucoes-equipe")?.value?.trim() || "";

  const resp = await fetch(`${API_BASE}/ocorrencias/${idOcorrencia}/finalizar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_equipe: equipeSelecionada ? Number(equipeSelecionada.id_equipe ?? equipeSelecionada.id) : null,
      observacao,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    alert(data.detail || "Erro ao finalizar ocorrência.");
    return;
  }

  alert(data.mensagem || "Ocorrência finalizada e salva no histórico!");
  fecharModal();
  await carregarOcorrencia();
  await carregarEquipes();
}

function fecharModal() {
  document.getElementById("modal-sucesso")?.classList.add("hidden");
}

function irParaAlertas() {
  window.location.href = "pagina04.html";
}

document.addEventListener("DOMContentLoaded", async () => {
  atualizarHoraSincronizacao();
  configurarPrioridades();

  document.getElementById("btn-confirmar-acionamento")?.addEventListener("click", confirmarAcionamento);
  document.getElementById("btn-finalizar-ocorrencia")?.addEventListener("click", finalizarOcorrenciaAtual);
  document.getElementById("btn-cancelar")?.addEventListener("click", () => {
    window.location.href = "pagina04.html";
  });

  await carregarOcorrencia();
  await carregarEquipes();
});