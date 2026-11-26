const API_URL = "http://127.0.0.1:8000/api";
let sensorChart = null;
let posteSelecionado = null;

document.addEventListener("DOMContentLoaded", async () => {
  iniciarRelogioSincronizacao();
  configurarFiltrosTempo();
  configurarExportacaoCSV();
  inicializarGraficoOscilacoes();

  await carregarDadosSensor();
  await atualizarGraficoOscilacoes();
  await atualizarTabelaEventos();

  setInterval(async () => {
    await atualizarGraficoOscilacoes();
    await atualizarTabelaEventos();
  }, 1500);
});

// 1. RELÓGIO DE SINCRONIZAÇÃO NO TOPO
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

// 2. CARREGA DADOS DO POSTE/SENSOR SELECIONADO (VIA ?poste=... OU PRIMEIRO DA LISTA)
async function carregarDadosSensor() {
  const params = new URLSearchParams(window.location.search);
  const codigoPosteUrl = params.get("poste");

  try {
    const resPostes = await fetch(`${API_URL}/postes`);
    if (!resPostes.ok) return;

    const postes = await resPostes.json();
    if (!postes || postes.length === 0) return;

    posteSelecionado = codigoPosteUrl
      ? postes.find(p => p.codigo_poste === codigoPosteUrl)
      : postes.find(p => p.status_energia === "sem_energia") || postes[0];

    if (posteSelecionado) {
      const subtituloHeader = document.querySelector(".header-left p");
      if (subtituloHeader) {
        subtituloHeader.textContent = `Leituras, eventos e manutenções registradas no ${posteSelecionado.codigo_poste} — ${posteSelecionado.bairro || "Juazeiro do Norte"}, CE`;
      }

      const tituloSensor = document.querySelector(".sensor-info h2");
      if (tituloSensor) {
        const codigoSensor = posteSelecionado.codigo_poste.replace("PST", "SNR");
        tituloSensor.textContent = `Sensor ${codigoSensor} • ${posteSelecionado.endereco}`;
      }

      const subtituloSensor = document.querySelector(".sensor-info p");
      if (subtituloSensor) {
        subtituloSensor.textContent = `CORRENTE + VIBRAÇÃO • POSTE ${posteSelecionado.codigo_poste} • REDE ${posteSelecionado.protocolo_rede || "LORAWAN"}`;
      }
    }
  } catch (erro) {
    console.warn("Não foi possível carregar detalhes do poste na pagina05:", erro);
  }
}

// 3. INICIALIZA O GRÁFICO NO CANVAS #sensorReadingsChart
function inicializarGraficoOscilacoes() {
  const canvas = document.getElementById("sensorReadingsChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  sensorChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Corrente elétrica",
          data: [],
          borderColor: "#06b6d4", // Ciano da legenda (.dot.cyan)
          backgroundColor: "rgba(6, 182, 212, 0.14)",
          borderWidth: 2.5,
          tension: 0.38,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: "#06b6d4"
        },
        {
          label: "Vibração",
          data: [],
          borderColor: "#f59e0b", // Laranja da legenda (.dot.orange)
          backgroundColor: "rgba(245, 158, 11, 0.08)",
          borderWidth: 2.5,
          tension: 0.38,
          fill: false,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: "#f59e0b"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: { display: false }, // Usa a legenda personalizada do HTML
        tooltip: {
          backgroundColor: "#0f172a",
          titleColor: "#f8fafc",
          bodyColor: "#cbd5e1",
          borderColor: "rgba(148, 163, 184, 0.2)",
          borderWidth: 1
        }
      },
      scales: {
        x: {
          ticks: { color: "#94a3b8", font: { size: 11 } },
          grid: { color: "rgba(148, 163, 184, 0.08)" }
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#94a3b8", font: { size: 11 } },
          grid: { color: "rgba(148, 163, 184, 0.12)" }
        }
      }
    }
  });
}

// 4. BUSCA AS LEITURAS NA API (/api/metricas) E MOVIMENTA AS ONDAS DO GRÁFICO
async function atualizarGraficoOscilacoes() {
  if (!sensorChart) return;

  try {
    const queryPoste = posteSelecionado?.codigo_poste
      ? `?poste=${encodeURIComponent(posteSelecionado.codigo_poste)}`
      : "";

    const resposta = await fetch(`${API_URL}/metricas${queryPoste}`);
    if (!resposta.ok) return;

    const dados = await resposta.json();
    let leituras = dados.leituras || [];

    // Filtra leituras do poste em foco, se houver registros específicos dele
    if (posteSelecionado && posteSelecionado.codigo_poste) {
      const leiturasDoPoste = leituras.filter(l => l.codigo_poste === posteSelecionado.codigo_poste);
      if (leiturasDoPoste.length > 0) {
        leituras = leiturasDoPoste;
      }
    }

    // Eixo X: horário da leitura (HH:MM:SS)
    sensorChart.data.labels = leituras.map(l => {
      if (l.data_hora_leitura) {
        const partes = String(l.data_hora_leitura).replace("T", " ").split(" ");
        return partes[1] ? partes[1].slice(0, 8) : l.codigo_poste;
      }
      return l.codigo_poste;
    });

    // Curva 1: Corrente elétrica
    sensorChart.data.datasets[0].data = leituras.map(l => Number(l.corrente) || 0);

    // Curva 2: Vibração
    sensorChart.data.datasets[1].data = leituras.map(l => Number(l.vibracao) || 0);

    // Destaca em vermelho (.dot.red) os pontos onde houve corte de corrente (evento detectado)
    sensorChart.data.datasets[0].pointBackgroundColor = leituras.map(l =>
      Number(l.corrente) === 0 ? "#ef4444" : "#06b6d4"
    );
    sensorChart.data.datasets[0].pointRadius = leituras.map(l =>
      Number(l.corrente) === 0 ? 6 : 4
    );

    sensorChart.update();
  } catch (erro) {
    console.error("Erro ao buscar oscilações na API:", erro);
  }
}

// 5. BOTÕES DE FILTRO (24 HORAS / 7 DIAS / 30 DIAS)
function configurarFiltrosTempo() {
  const botoesFiltro = document.querySelectorAll(".filter-btn");
  botoesFiltro.forEach(btn => {
    btn.addEventListener("click", () => {
      botoesFiltro.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      atualizarGraficoOscilacoes();
    });
  });
}

// 6. BOTÃO EXPORTAR CSV
function configurarExportacaoCSV() {
  const btnExport = document.querySelector(".btn-export");
  if (!btnExport || !sensorChart) return;

  btnExport.addEventListener("click", () => {
    const labels = sensorChart.data.labels;
    const correntes = sensorChart.data.datasets[0].data;
    const vibracoes = sensorChart.data.datasets[1].data;

    let csv = "Horario;Corrente;Vibracao\n";
    labels.forEach((lbl, i) => {
      csv += `${lbl};${correntes[i] ?? 0};${vibracoes[i] ?? 0}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `historico_sensor_${posteSelecionado?.codigo_poste || "lumos"}.csv`;
    link.click();
  });
}

// 7. CONECTA A TABELA "REGISTRO DE EVENTOS" NA API
async function atualizarTabelaEventos() {
  const tbody = document.querySelector(".events-table tbody");
  if (!tbody) return;

  try {
    const queryPoste = posteSelecionado?.codigo_poste
      ? `?poste=${encodeURIComponent(posteSelecionado.codigo_poste)}`
      : "";

    const [resMetricas, resOcorrencias] = await Promise.all([
      fetch(`${API_URL}/metricas${queryPoste}`),
      fetch(`${API_URL}/ocorrencias`)
    ]);

    if (!resMetricas.ok) return;

    const dadosMetricas = await resMetricas.json();
    const ocorrencias = resOcorrencias.ok ? await resOcorrencias.json() : [];

    // Pega as últimas leituras (mais recentes primeiro)
    let leituras = [...(dadosMetricas.leituras || [])].reverse();

    // Filtra pelo poste selecionado na página, se houver
    if (posteSelecionado && posteSelecionado.codigo_poste) {
      const filtradas = leituras.filter(l => l.codigo_poste === posteSelecionado.codigo_poste);
      if (filtradas.length > 0) leituras = filtradas;
    }

    if (leituras.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-muted" style="text-align: center;">
            Aguardando leituras do sensor na API...
          </td>
        </tr>
      `;
      return;
    }

    // Verifica se há alguma ocorrência em atendimento para este poste
    const ocorrenciaAtiva = ocorrencias.find(
      o => o.codigo_poste === (posteSelecionado?.codigo_poste || leituras[0].codigo_poste) &&
           o.status_alerta !== "resolvida"
    );

    tbody.innerHTML = leituras.slice(0, 8).map(leitura => {
      const corrente = Number(leitura.corrente) || 0;
      const vibracao = Number(leitura.vibracao) || 0;

      // Formata Data / Hora (se vier do banco, senão mostra o ID da leitura)
      const campoData = leitura.data_hora_leitura || leitura.data_hora || leitura.created_at;
      let dataFormatada = `Leitura #${leitura.id_da_leitura}`;
      if (campoData) {
        const dt = new Date(campoData);
        if (!isNaN(dt.getTime())) {
          const dia = String(dt.getDate()).padStart(2, "0");
          const mes = String(dt.getMonth() + 1).padStart(2, "0");
          const hora = String(dt.getHours()).padStart(2, "0");
          const min = String(dt.getMinutes()).padStart(2, "0");
          dataFormatada = `${dia}/${mes} • ${hora}:${min}`;
        }
      }

      // Classifica Tipo, Corrente, Vibração e Desfecho conforme os valores do hardware
      let tagClasse = "tag-normal";
      let tagTexto = "normal";
      let correnteHtml = `${corrente}%`;
      let vibracaoTexto = vibracao > 50 ? "alta" : vibracao > 15 ? "média" : vibracao > 0 ? "baixa" : "nula";
      let desfechoClasse = "text-muted";
      let desfechoTexto = "sem ação";

      if (corrente === 0) {
        tagClasse = "tag-furto";
        tagTexto = "queda / corte";
        correnteHtml = `0% <span class="arrow-down">↓</span>`;
        desfechoClasse = "text-danger";
        desfechoTexto = ocorrenciaAtiva ? "em atendimento" : "alerta aberto";
      } else if (vibracao > 20 || corrente < 80) {
        tagClasse = "tag-oscilacao";
        tagTexto = "oscilação";
        desfechoTexto = "monitorado";
      }

      return `
        <tr>
          <td>${dataFormatada}</td>
          <td><span class="tag ${tagClasse}">${tagTexto}</span></td>
          <td>${correnteHtml}</td>
          <td>${vibracaoTexto}</td>
          <td class="${desfechoClasse}">${desfechoTexto}</td>
        </tr>
      `;
    }).join("");

  } catch (erro) {
    console.error("Erro ao conectar tabela de eventos na API:", erro);
  }
}