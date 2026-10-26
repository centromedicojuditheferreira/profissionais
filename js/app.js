/* ═══════════════════════════════════════════════════════════════════
   Profissionais · Lev Soul — profissionais.levsoul.com.br   (v1 · 24/10/2026)
   Fala com o Supabase da clínica só pelas funções prof_* (chave publicável;
   nenhuma tabela aberta). Entrada por e-mail e senha (PROF v3.0); no primeiro
   acesso a senha provisória é trocada antes de qualquer dado abrir.
   As regras da conferência, da confirmação com selfie e do recibo são as
   mesmas do Cortex (js/profissional.js de lá) — só a casa é nova.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
"use strict";

var CFG = { url: 'https://xcucoryngkkuszztpxyq.supabase.co', key: 'sb_publishable_6ATQUvqBBRS5xx7jAYKlmw_2FwTuHG7' };
var FOTO_LADO_MAX = 900, FOTO_QUALIDADE = 0.72, FOTO_CAMERA = 'user';   /* 'user' = selfie */
var DIAS = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
var MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

var MSG = {
  LOGIN_INVALIDO: 'E-mail ou senha não conferem. Confira e tente de novo.',
  SENHA_INVALIDA: 'A sua senha mudou. Entre de novo com o e-mail e a senha atual.',
  BLOQUEADO_TEMPORARIAMENTE: 'Muitas tentativas seguidas. Aguarde 15 minutos e tente de novo.',
  PROVISORIA_VENCIDA: 'A sua senha provisória venceu. Peça uma nova à recepção pelo WhatsApp.',
  TROCAR_SENHA: 'Entre de novo com o seu e-mail e a senha provisória para criar a sua senha.',
  SENHA_CURTA: 'A senha precisa ter pelo menos 4 caracteres.',
  SENHA_PROVISORIA: 'A senha não pode ser 0000. Escolha outra.',
  SENHA_IGUAL: 'A nova senha precisa ser diferente da atual.',
  SEM_CONEXAO: 'Sem conexão com o sistema da clínica. Confira a internet e tente de novo.',
  SEMANA_FECHADA: 'Este período já encerrou e seguiu para o faturamento. Fale com a recepção.',
  AINDA_NAO_ABRIU: 'A conferência deste período ainda não foi liberada.',
  JA_CONFIRMADA: 'Este período já foi confirmado.',
  FOTO_OBRIGATORIA: 'A confirmação precisa da sua selfie, que é a sua assinatura.',
  FOTO_GRANDE: 'A foto ficou grande demais. Tire outra.',
  FOTO_INVALIDA: 'Não deu para ler a foto. Tire outra.',
  SEM_RECIBO: 'Ainda não há recibo para este mês.',
  PAPEL_ERRADO: 'Este acesso não é de profissional.'
};
var SAIR_SE = { TROCAR_SENHA: 1, PROVISORIA_VENCIDA: 1, SENHA_INVALIDA: 1, BLOQUEADO_TEMPORARIAMENTE: 1 };

var sess = { id: null, senha: null, email: null, nome: null, fotoObrigatoria: true, tutorialVisto: true, horaPrazo: '22h' };
var prov = { email: null, senha: null, nome: null };    /* primeiro acesso: só até a senha nova ser criada */
var atual = null, previaAtual = null, relogioOffset = 0, timerFaixa = null;
var mesAtual = null;    /* o cartão "seu mês" (prof_meu_mes, PROF v3.1); fica nulo se o regime não tem recibo ou o banco ainda não tem a função */

/* ── utilidades ── */
function $(s, el){ return (el || document).querySelector(s); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
function humano(e){ return MSG[e && e.message] || ('Não deu certo: ' + (e && e.message)); }
function dLocal(s){ var p = String(s).slice(0, 10).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function ddmm(s){ var d = dLocal(s); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); }
function dmy(s){ if(!s) return ''; var p = String(s).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function hhmm(t){ return (t || '').slice(0, 5); }
function agora(){ return Date.now() + relogioOffset; }
var RS = 'R$ ';   /* "R$" nunca fica sozinho no fim da linha */
function brl(v){ return RS + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function brlCurto(v){ v = Number(v) || 0; return v === Math.round(v) ? RS + v.toLocaleString('pt-BR') : brl(v); }          /* "R$ 17" nas regras */
function brlUnit(v){   /* valor unitário exato: a nutrição tem 4 casas (R$ 28,5384) */
  v = Number(v) || 0;
  return Math.abs(v * 100 - Math.round(v * 100)) > 1e-6 ? RS + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : brl(v);
}
function pctBr(p){ return p == null ? '—' : Number(p).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'; }
function plural(n, um, varios){ n = Number(n) || 0; return n.toLocaleString('pt-BR') + ' ' + (n === 1 ? um : varios); }
function cap(s){ s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
function nomeDoMes(iso){ return MESES[dLocal(iso).getMonth()]; }
function mesSeguinte(iso){ return MESES[(dLocal(iso).getMonth() + 1) % 12]; }
function ddmmTs(iso){ return iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : ''; }
function fmtTs(iso){ return iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(', ', ' às ') : ''; }
function horaCurta(iso){
  var t = new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
  var p = t.split(':'), h = String(Number(p[0]));
  return p[1] === '00' ? h + 'h' : h + 'h' + p[1];
}
function fmtDiaHora(iso){
  var dia = new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' });
  var h = horaCurta(iso);
  return h === '12h' ? dia + ', ao meio-dia' : dia + ', às ' + h;
}
function diaSemana(iso){ return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }); }
function nomeBonito(n){
  var miudas = { da:1, de:1, di:1, do:1, das:1, dos:1, e:1 };
  return String(n || '').toLowerCase().split(/\s+/).filter(Boolean).map(function(p, i){
    return (i > 0 && miudas[p]) ? p : p.charAt(0).toUpperCase() + p.slice(1);
  }).join(' ');
}
function primeiroNome(n){ return nomeBonito(n).split(' ')[0] || ''; }
function ehCelular(){ return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); }
function lembrar(email){ try{ localStorage.setItem('prof.email', email); }catch(e){} }
function lembrado(){ try{ return localStorage.getItem('prof.email') || ''; }catch(e){ return ''; } }

function rpc(fn, args){
  return fetch(CFG.url + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': CFG.key, 'Authorization': 'Bearer ' + CFG.key },
    body: JSON.stringify(args || {})
  }).catch(function(){ throw new Error('SEM_CONEXAO'); }).then(function(r){
    return r.text().then(function(t){
      var j = null; try{ j = JSON.parse(t); }catch(e){}
      if(!r.ok) throw new Error((j && (j.message || j.hint || j.details)) || ('HTTP ' + r.status));
      if(j && j.ok === false) throw new Error(j.erro || 'ERRO');
      return j;
    });
  });
}

/* ═══════════════ A PORTA ═══════════════ */
function mostraPorta(qual){
  var porta = $('#porta');
  porta.hidden = false; porta.classList.remove('saindo');
  $('#app').hidden = true;
  $('#f-entrar').hidden = qual !== 'entrar';
  $('#f-senha').hidden = qual !== 'senha';
  document.title = 'Profissionais · Lev Soul';
  setTimeout(function(){
    var alvo = qual === 'senha' ? $('#s-nova') : ($('#e-email').value ? $('#e-senha') : $('#e-email'));
    if(alvo && !ehCelular()) alvo.focus();
  }, 60);
}
function erroPorta(id, txt, caixa){
  var el = $(id); el.textContent = txt; el.hidden = !txt;
  if(txt && caixa){ caixa.classList.remove('treme'); void caixa.offsetWidth; caixa.classList.add('treme'); }
}
function aguarde(btn, sim, txt){
  btn.classList.toggle('aguarde', sim); btn.disabled = sim;
  if(txt != null){ var svg = btn.querySelector('svg'); btn.textContent = txt; if(svg) btn.appendChild(svg); }
}

function entrar(ev){
  if(ev) ev.preventDefault();
  var email = $('#e-email').value.trim().toLowerCase(), senha = $('#e-senha').value, f = $('#f-entrar'), btn = $('#e-ok');
  erroPorta('#e-erro', '');
  if(!email) return erroPorta('#e-erro', 'Digite o seu e-mail.', f);
  if(!senha) return erroPorta('#e-erro', 'Digite a sua senha.', f);
  aguarde(btn, true);
  rpc('prof_entrar_email', { p_email: email, p_senha: senha }).then(function(r){
    lembrar(email);
    $('#e-senha').value = '';
    if(r.trocar_senha){
      prov = { email: email, senha: senha, nome: r.nome };
      $('#s-ola').textContent = 'Olá, ' + primeiroNome(r.nome) + '. Esta senha é só sua: é com ela que você entra daqui para a frente.';
      $('#s-usuario').value = email;
      $('#s-nova').value = ''; $('#s-repete').value = ''; erroPorta('#s-erro', '');
      mostraPorta('senha');
      return;
    }
    return abrirApp(r, senha);
  }).catch(function(e){
    erroPorta('#e-erro', humano(e), f);
    if(e.message === 'LOGIN_INVALIDO'){ $('#e-senha').value = ''; if(!ehCelular()) $('#e-senha').focus(); }
  }).then(function(){ aguarde(btn, false); });
}

function criarSenha(ev){
  if(ev) ev.preventDefault();
  var s1 = $('#s-nova').value, s2 = $('#s-repete').value, f = $('#f-senha'), btn = $('#s-ok');
  erroPorta('#s-erro', '');
  if(s1.length < 4) return erroPorta('#s-erro', MSG.SENHA_CURTA, f);
  if(s1 === '0000') return erroPorta('#s-erro', MSG.SENHA_PROVISORIA, f);
  if(s1 !== s2) return erroPorta('#s-erro', 'As duas senhas não estão iguais.', f);
  aguarde(btn, true, 'Salvando…');
  rpc('prof_trocar_senha_email', { p_email: prov.email, p_senha_atual: prov.senha, p_senha_nova: s1 })
    .then(function(){ return rpc('prof_entrar_email', { p_email: prov.email, p_senha: s1 }); })
    .then(function(r){ prov = { email: null, senha: null, nome: null }; return abrirApp(r, s1); })
    .catch(function(e){
      if(e.message === 'LOGIN_INVALIDO' || e.message === 'PROVISORIA_VENCIDA'){
        mostraPorta('entrar'); erroPorta('#e-erro', e.message === 'PROVISORIA_VENCIDA' ? MSG.PROVISORIA_VENCIDA : MSG.TROCAR_SENHA, $('#f-entrar'));
      } else erroPorta('#s-erro', humano(e), f);
    })
    .then(function(){ aguarde(btn, false, 'Salvar senha e entrar'); });
}

function esqueci(){
  folha('<h2>Esqueceu a senha?</h2>' +
    '<p>Peça à recepção, pelo WhatsApp, uma senha provisória nova. Você entra com o seu e-mail e com ela, e cria a sua senha na hora.</p>',
    '<button type="button" class="btn btn-pri" data-fecha>Entendi</button>');
}

/* ═══════════════ DENTRO ═══════════════ */
function abrirApp(r, senha){
  sess.id = r.profissional_id; sess.senha = senha; sess.email = r.email; sess.nome = r.nome;
  sess.fotoObrigatoria = r.foto_obrigatoria !== false; sess.tutorialVisto = !!r.tutorial_visto_em;
  if(r.prazo) sess.horaPrazo = horaCurta(r.prazo);
  if(r.agora) relogioOffset = new Date(r.agora).getTime() - Date.now();
  $('#a-nome').textContent = nomeBonito(r.nome);
  $('#app').hidden = false;
  var porta = $('#porta'); porta.classList.add('saindo');
  setTimeout(function(){ porta.hidden = true; }, 460);
  window.scrollTo(0, 0);
  return carregar().then(function(){ if(sess.id && atual && !sess.tutorialVisto) tutorial(true); });
}

function sairCom(msg){
  sess = { id: null, senha: null, email: null, nome: null, fotoObrigatoria: true, tutorialVisto: true, horaPrazo: '22h' };
  atual = null; mesAtual = null; clearInterval(timerFaixa); fechaCamadas();
  $('#a-lista').innerHTML = ''; $('#a-regras').innerHTML = ''; $('#a-previa').innerHTML = ''; $('#a-recibos').innerHTML = ''; $('#a-mes').innerHTML = '';
  $('#e-email').value = lembrado(); $('#e-senha').value = '';
  mostraPorta('entrar');
  if(msg) erroPorta('#e-erro', msg);
}

function carregar(){
  var mes = rpc('prof_meu_mes', { p_profissional_id: sess.id, p_senha: sess.senha })
    .catch(function(e){ if(SAIR_SE[e.message]) throw e; return null; });   /* sem recibo, sem regime ou banco sem o v3.1: segue sem o cartão */
  return Promise.all([rpc('prof_listar_semana', { p_profissional_id: sess.id, p_senha: sess.senha, p_semana_inicio: null }), mes]).then(function(x){
    var d = x[0];
    atual = d; mesAtual = (x[1] && x[1].ok !== false) ? x[1] : null; previaAtual = null;
    if(d.agora) relogioOffset = new Date(d.agora).getTime() - Date.now();
    if(d.prazo) sess.horaPrazo = horaCurta(d.prazo);
    pintaFaixa(d);
    $('#a-previa').innerHTML = '';
    $('#a-mes').innerHTML = mesAtual ? mesHtml(mesAtual, d) : '';
    if(d.aberta === false) renderFechada(d); else { renderAberta(d); if(!mesAtual) carregaPrevia(d); }
    renderRecibos(d);
    document.title = 'Agenda · Profissionais';
  }).catch(function(e){
    if(SAIR_SE[e.message]) return sairCom(humano(e));
    $('#a-lista').innerHTML = '<p class="erro-txt">' + esc(humano(e)) + '</p><div class="acoes"><button type="button" class="btn" id="a-tentar">Tentar de novo</button></div>';
    $('#a-tentar').onclick = carregar;
  });
}

function fechaOMes(d){   /* a confirmação deste período gera o recibo: os últimos dias do mês, ou a última semana de um mês que acaba no domingo */
  var fim = d && (d.periodo_fim || d.semana_fim);
  return !!d && (d.tipo_periodo === 'fechamento_mes' || (!!fim && dLocal(fim).getDate() === ultimoDiaDoMes(fim)));
}
function periodoTxt(d){
  var ini = d.periodo_inicio || d.semana_inicio, fim = d.periodo_fim || d.semana_fim;
  if(d.tipo_periodo === 'fechamento_mes') return 'Últimos dias de ' + MESES[dLocal(fim).getMonth()] + ': ' + ddmm(ini) + ' a ' + ddmm(fim);
  return (d.periodo_especial ? 'Agenda de ' : 'Semana de ') + ddmm(ini) + ' a ' + ddmm(fim);
}
function faltaTxt(ms){
  var h = Math.floor(ms / 36e5), d = Math.floor(h / 24), hr = h % 24, min = Math.floor((ms % 36e5) / 6e4);
  if(d >= 1) return d + (d > 1 ? ' dias' : ' dia') + (hr ? ' e ' + hr + ' h' : '');
  if(h >= 1) return h + ' h' + (min ? ' ' + min + ' min' : '');
  return Math.max(1, min) + ' min';
}

/* a faixa do prazo */
function pintaFaixa(d){
  var faixa = $('#a-faixa');
  $('#a-periodo').textContent = periodoTxt(d);
  var render = function(){
    var rot = '', grande = '', sub = '', cls = '';
    var prazo = new Date(d.prazo).getTime(), fech = new Date(d.fechamento).getTime();
    if(d.motivo === 'confirmada'){
      cls = 'confirmada'; grande = 'Agenda confirmada';
      sub = 'Registrada em ' + fmtTs(d.confirmada_em) + '.' + (d.proxima_abertura ? ' A próxima conferência abre ' + fmtDiaHora(d.proxima_abertura) + '.' : '');
    } else if(d.motivo === 'antes_da_abertura'){
      var msA = new Date(d.abre_em).getTime() - agora();
      cls = 'antes'; rot = 'A conferência abre';
      grande = diaSemana(d.abre_em).replace('-feira', '') + ', ' + horaCurta(d.abre_em);
      sub = msA > 0 ? 'Faltam ' + faltaTxt(msA) + '. Você será avisado pelo WhatsApp.' : 'Liberando agora. Atualize a página.';
    } else if(d.motivo === 'fechada' || agora() > fech){
      cls = 'fechada'; grande = 'Período encerrado';
      sub = 'A agenda seguiu para o faturamento com as informações registradas.' + (d.proxima_abertura ? ' A próxima conferência abre ' + fmtDiaHora(d.proxima_abertura) + '.' : '');
    } else {
      var ms = prazo - agora();
      if(ms <= 0){
        cls = 'passou'; grande = 'Prazo encerrado';
        sub = 'O prazo era ' + fmtDiaHora(d.prazo) + '. Se ainda houver alguma correção, avise a recepção agora.';
      } else {
        cls = ms < 4 * 36e5 ? 'alerta' : ''; rot = 'Faltam'; grande = faltaTxt(ms);
        sub = 'para conferir e confirmar. Prazo: ' + fmtDiaHora(d.prazo) + '.' + (d.modo_teste ? ' (Acesso de teste até ' + fmtTs(d.teste_ate) + '.)' : '');
      }
    }
    faixa.className = 'faixa' + (cls ? ' ' + cls : '');
    $('#a-rot').textContent = rot; $('#a-rot').hidden = !rot;
    $('#a-grande').textContent = grande.charAt(0).toUpperCase() + grande.slice(1);
    $('#a-sub').textContent = sub;
  };
  render(); clearInterval(timerFaixa); timerFaixa = setInterval(render, 30000);
}

function classeStatus(it){
  if(it.em_feriado) return 'feriado';
  if(it.futuro) return 'fut';
  var t = (it.status_exibido || '').toLowerCase();
  if(t.indexOf('atendido') === 0) return 'ok';
  if(t.indexOf('não compareceu') === 0 || t.indexOf('nao compareceu') === 0) return 'falta';
  return 'neutro';
}
function linhasHtml(itens){
  var porDia = {}, ordem = [];
  itens.forEach(function(i){ if(!porDia[i.data]){ porDia[i.data] = []; ordem.push(i.data); } porDia[i.data].push(i); });
  return ordem.map(function(data){
    var dt = dLocal(data), feriado = porDia[data].some(function(i){ return i.em_feriado; });
    return '<section class="dia"><h2>' + DIAS[dt.getDay()] + ', ' + ddmm(data) + (feriado ? ' <small>· feriado</small>' : '') + '</h2>' +
      porDia[data].map(function(it){
        return '<div class="item' + (it.futuro ? ' futuro' : '') + '">' +
          '<span class="hora">' + esc(hhmm(it.horario) || '—') + '</span>' +
          '<span class="nome">' + esc(it.paciente ? nomeBonito(it.paciente) : '(sem paciente)') + '</span>' +
          '<span class="conv">' + esc(it.convenio || 'sem convênio') + '</span>' +
          '<span class="situ"><span class="chip ' + classeStatus(it) + '">' + esc(it.status_exibido || it.status || '') + '</span></span>' +
          '</div>';
      }).join('') + '</section>';
  }).join('');
}

function renderAberta(d){
  var fechaMes = fechaOMes(d);
  var ini = d.periodo_inicio || d.semana_inicio, fim = d.periodo_fim || d.semana_fim;
  $('#a-regras').innerHTML = '<div class="regras">' +
    '<p><b>Confira consulta por consulta.</b> Algo errado na situação, no horário, no paciente ou no convênio? <b>Avise a recepção pelo WhatsApp e não confirme ainda.</b> A correção aparece aqui até a manhã seguinte. <b>Só confirme quando tudo estiver corrigido aqui.</b></p>' +
    '<p>' + (fechaMes ? 'Ao confirmar, o mês fecha e o seu recibo de repasse sai na hora.' : 'Depois de confirmada, a agenda não muda mais por aqui.') +
    ' <button type="button" class="link" data-tutorial>Como funciona</button></p>' +
    (ehCelular() ? '' : '<p class="alerta-txt">A confirmação é feita pelo celular e assinada com uma selfie.</p>') + '</div>';
  var itens = d.itens || [];
  var h = '<div class="resumo"><span>' + (itens.length ? itens.length + (itens.length === 1 ? ' consulta' : ' consultas') : '') + '</span></div>';
  h += itens.length ? linhasHtml(itens) : '<p class="vazio">Nenhuma consulta sua neste período.</p>';
  h += '<div class="acoes"><button type="button" class="btn" id="a-pdf">Baixar prévia em PDF</button></div>';
  $('#a-lista').innerHTML = h;
  $('#a-pdf').onclick = function(){ baixarRelatorio(d, this); };
  var rod = $('#a-rodape'); rod.hidden = false;
  var btn = $('#a-confirmar');
  btn.textContent = fechaMes ? 'Está tudo certo — confirmar o mês' : 'Está tudo certo — confirmar';
  btn.disabled = false;
  btn.onclick = function(){ abreConfirmacao(d); };
  $('#a-nota').textContent = (d.prazo_passou || d.fechada) ? 'O prazo encerrou. A confirmação fica registrada como feita depois do prazo.'
    : 'Só confirme se não houver nenhuma correção pendente na recepção.' + (ehCelular() ? '' : ' A confirmação é feita pelo celular.');
}

function renderFechada(d){
  $('#a-rodape').hidden = true;
  var ini = d.periodo_inicio || d.semana_inicio, fim = d.periodo_fim || d.semana_fim, txt;
  if(d.motivo === 'confirmada') txt = 'Sua agenda de ' + ddmm(ini) + ' a ' + ddmm(fim) + ' foi confirmada e segue para o faturamento com as informações conferidas.';
  else if(d.motivo === 'antes_da_abertura') txt = 'A conferência da agenda de ' + ddmm(ini) + ' a ' + ddmm(fim) + ' fica liberada ' + fmtDiaHora(d.abre_em) + '. O prazo para conferir e confirmar é ' + fmtDiaHora(d.prazo) + '.';
  else txt = 'O prazo de conferência da agenda de ' + ddmm(ini) + ' a ' + ddmm(fim) + ' encerrou, e ela seguiu para o faturamento com as informações registradas.';
  $('#a-regras').innerHTML = '<div class="regras"><p>' + esc(txt) + '</p><p><button type="button" class="link" data-tutorial>Como funciona</button></p></div>';
  var itens = d.itens || [], h = '';
  if(d.motivo === 'confirmada'){
    h += '<div class="acoes"><button type="button" class="btn btn-pri" id="a-pdf">Baixar comprovante em PDF</button></div>';
    if(itens.length) h += '<div class="resumo"><span>O que você confirmou: ' + itens.length + (itens.length === 1 ? ' consulta' : ' consultas') + '</span></div>' + linhasHtml(itens);
  } else {
    h += '<p class="vazio">' + (d.motivo === 'antes_da_abertura' ? 'Nenhuma conferência liberada no momento.' : 'Nenhuma pendência.') + '</p>';
  }
  $('#a-lista').innerHTML = h;
  if(d.motivo === 'confirmada') $('#a-pdf').onclick = function(){ baixarRelatorio(d, this); };
}

/* ═══════════════ O SEU MÊS ═══════════════
   O valor cresce a cada semana liberada (nunca a cada dia: horário que ainda não aconteceu não entra).
   Quem tem pós vê as sessões de plano a R$ 15 até o mês fechar e, ao lado, quanto o mês vai a com a meta
   de 70% — o recibo nunca vem abaixo do que a tela mostrou, só igual ou acima (a não ser por correção).
   A presença aparece para todo mundo (padrão da clínica: 70%), com as consultas que o próprio profissional
   desmarcou — a parte da presença que ele controla —, a sequência de semanas sem desmarcar e a melhor presença
   da clínica no mês. Ninguém vê o número de ninguém: só o seu, o do seu mês anterior e o melhor da casa. */
function sessoesPlano(q){ return q === 1 ? 'a sua sessão de plano' : 'as suas ' + Number(q).toLocaleString('pt-BR') + ' sessões de plano'; }
function ultimoDiaDoMes(iso){ var d = dLocal(iso); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
/* A meta ainda cabe neste mês? Perto da meta, mostrar quanto falta acelera (gradiente de meta); longe dela, um número
   impossível desanima — aí o texto fala do que já foi feito e do recomeço no mês seguinte. A estimativa usa o ritmo
   do próprio mês (atendimentos por dia até agora × dias que faltam) e só escolhe o texto; o número não aparece. */
function metaCabe(m, qual){   /* qual: 'presenca' (todo mundo) ou 'contagem' (quem recebe por contagem) */
  if(m.completo) return true;
  var ini = dLocal(m.inicio), ate = dLocal(m.ate), fim = new Date(ini.getFullYear(), ini.getMonth() + 1, 0);
  var passados = Math.round((ate - ini) / 864e5) + 1, restantes = Math.round((fim - ate) / 864e5);
  var ritmo, falta;
  if(qual === 'contagem'){
    var t = m.meta; if(!t || t.tipo !== 'contagem' || Number(t.contagem) > Number(t.ate_n)) return true;
    ritmo = Number(t.contagem) || 0; falta = Number(t.faltam) + 1;   /* a faixa começa na 91ª */
  } else {
    var p = m.presenca; if(!p || p.atingiu) return true;
    ritmo = (m.atendidos || 0) + (m.faltas || 0); falta = Number(p.seguidos);
  }
  return falta <= Math.ceil(ritmo * restantes / Math.max(1, passados));
}
function comparaAnterior(m){   /* comparado só com o próprio mês anterior; subiu, a tela diz */
  var a = m.mes_anterior; if(!a || a.pct == null) return '';
  var dif = Math.round((Number(m.pct || 0) - Number(a.pct)) * 10) / 10;
  return 'Em ' + nomeDoMes(a.competencia) + ': ' + pctBr(a.pct) + '.' + (dif > 0 ? ' Você subiu ' + dif.toLocaleString('pt-BR') + (dif === 1 ? ' ponto.' : ' pontos.') : '');
}
function incremento(m, d){   /* quanto entrou no último período liberado, e como chamar esse período */
  if(!m.semana || !(Number(m.semana.valor) > 0)) return null;
  var fim = d && (d.periodo_fim || d.semana_fim), rot;
  if(fim === m.semana.fim) rot = fechaOMes(d) ? 'nos últimos dias do mês' : (d.periodo_especial ? 'neste período' : 'nesta semana');
  else rot = 'de ' + ddmm(m.semana.inicio) + ' a ' + ddmm(m.semana.fim);
  return { valor: Number(m.semana.valor), rot: rot, atendidos: m.semana.atendidos };
}
function desmarcadasHtml(m){   /* a parte da presença que o profissional controla: o que ele mesmo desmarcou */
  var p = m.presenca; if(!p) return '';
  var n = (m.atendidos || 0) + (m.faltas || 0), fa = m.faltas || 0, dm = Number(p.desmarcadas) || 0;
  if(!n) return '';
  if(!dm) return '<p class="desm ok-txt"><b>Nenhuma consulta desmarcada por você</b> em ' + nomeDoMes(m.competencia) + '.</p>';
  var h = '<p class="desm">Das <b>' + plural(fa, 'consulta', 'consultas') + '</b> que não ' + (fa === 1 ? 'aconteceu' : 'aconteceram') + ', <b>' + (dm === 1 ? '1 você desmarcou' : dm + ' você desmarcou') + '</b>.';
  if(p.pct_sem_desmarcar != null || Number(p.desmarcadas_valor) > 0){
    h += ' Sem ' + (dm === 1 ? 'ela' : 'elas') + ':' +
         (p.pct_sem_desmarcar != null ? ' presença de <b>' + pctBr(p.pct_sem_desmarcar) + '</b>' : '') +
         (Number(p.desmarcadas_valor) > 0 ? (p.pct_sem_desmarcar != null ? ' e ' : ' ') + 'mais <b>' + brl(p.desmarcadas_valor) + '</b> no mês' : '') + '.';
  }
  return h + '</p>';
}
function rotuloPeriodo(m, d){   /* como chamar o último período liberado */
  if(!d) return 'na última semana';
  var fim = d.periodo_fim || d.semana_fim;
  if(m.semana && fim !== m.semana.fim) return 'de ' + ddmm(m.semana.inicio) + ' a ' + ddmm(m.semana.fim);
  return fechaOMes(d) ? 'nos últimos dias do mês' : (d.periodo_especial ? 'neste período' : 'nesta semana');
}
function sequenciaHtml(m, d){
  var p = m.presenca; if(!p || p.sequencia == null) return '';
  var sq = Number(p.sequencia) || 0, sd = Number(p.semana_desmarcadas) || 0;
  if(sq >= 2) return '<p class="seq"><span class="selo-seq">' + sq + '</span> semanas seguidas sem desmarcar nenhum paciente.</p>';
  if(sq === 1) return '<p class="seq"><span class="selo-seq">1</span> semana sem desmarcar nenhum paciente. Mais uma e vira sequência.</p>';
  if(sd > 0 && !m.completo && !(d && d.periodo_especial)) return '<p class="seq zerou">Você desmarcou ' + plural(sd, 'paciente', 'pacientes') + ' ' + rotuloPeriodo(m, d) + '. A sequência de semanas sem desmarcar recomeça agora.</p>';
  return '';
}
function melhorHtml(m){
  var p = m.presenca; if(!p || !p.melhor || p.melhor.pct == null) return '';
  if(p.melhor.referencia) return '<p class="melhor">Referência de presença na clínica: <b>' + pctBr(p.melhor.pct) + '</b>.</p>';
  if(p.melhor.sua) return '<p class="melhor ok-txt"><b>A melhor presença da clínica este mês é a sua.</b></p>';
  return '<p class="melhor">Melhor presença da clínica este mês: <b>' + pctBr(p.melhor.pct) + '</b>.</p>';
}
function presencaHtml(m, d){   /* para todo mundo; o dinheiro só entra para quem tem pós */
  var p = m.presenca; if(!p) return '';
  var t = (m.meta && m.meta.tipo === 'presenca') ? m.meta : null;   /* quem tem pós: a presença mexe no valor */
  var mes = nomeDoMes(m.competencia), n = (m.atendidos || 0) + (m.faltas || 0), ok = !!p.atingiu, corte = Number(p.meta), pct = Number(m.pct || 0);
  var h = '<div class="meta"><div class="meta-h"><b>Presença</b><strong>' + pctBr(m.pct) + '</strong>' +
          (ok ? '<em class="selo-ok">' + (m.completo ? 'meta batida' : 'acima de ' + corte + '%') + '</em>' : '<span>meta ' + corte + '%</span>') + '</div>' +
        '<div class="barra' + (ok ? ' ok' : '') + '" role="img" aria-label="Presença de ' + pctBr(m.pct) + '; a meta é ' + corte + '%"><i style="width:' + Math.min(100, pct) + '%"></i><em style="left:' + corte + '%"></em></div>';
  if(!n) return h + '<p>Ainda sem atendimentos em ' + mes + '. A clínica espera ' + corte + '% de presença' + (t ? ': com isso, cada sessão de plano vale ' + brlCurto(t.plano_alto) : '') + '.</p></div>';
  h += desmarcadasHtml(m) + sequenciaHtml(m, d);
  var q = t ? Number(t.q_plano) || 0 : 0, alto = t ? brlCurto(t.plano_alto) : '', baixo = t ? brlCurto(t.plano_baixo) : '';
  var dinheiro = (t && q) ? ': o mês vai a <b>' + brl(m.com_meta) + '</b> (+ ' + brl(t.bonus) + ')' : '';
  if(!m.completo){
    if(ok) h += '<p><b class="ok-txt">Você está acima da meta.</b> ' + (t
      ? 'Mantendo ' + corte + '% até o fim de ' + mes + ', ' + (q ? sessoesPlano(q) + ' saem a ' + alto : 'cada sessão de plano vale ' + alto) + dinheiro + '.'
      : 'Mantenha assim até o fim de ' + mes + '.') + '</p>';
    else {
      h += '<p>Faltam <b>' + plural(p.seguidos, 'atendimento', 'atendimentos') + '</b> para chegar a ' + corte + '%' + (t ? '' : ', o padrão da clínica') + '.</p>';
      if(t) h += '<p>Com ' + corte + '% no fim de ' + mes + ', ' + (q ? sessoesPlano(q) + ' passam de ' + baixo + ' para ' + alto : 'cada sessão de plano vale ' + alto) + dinheiro + '.</p>';
      if(!metaCabe(m, 'presenca')) h += '<p>Em <b>' + mesSeguinte(m.competencia) + ', a contagem recomeça do zero</b>' + (t ? ': com ' + corte + '% no mês, cada sessão de plano vale ' + alto : '') + '.</p>';
    }
  } else {
    if(ok) h += '<p><b class="ok-txt">Meta batida.</b> ' + (t && q ? cap(sessoesPlano(q)) + ' saem a ' + alto + ' (+ ' + brl(t.bonus) + ').' : '') + '</p>';
    else h += '<p>A meta era ' + corte + '%' + (p.seguidos > 0 && p.seguidos <= 12 ? ': faltou pouco, ' + plural(p.seguidos, 'atendimento', 'atendimentos') : '') + '. Em ' + mesSeguinte(m.competencia) + ', a contagem recomeça do zero.</p>';
  }
  h += melhorHtml(m);
  if(comparaAnterior(m)) h += '<p class="ant">' + comparaAnterior(m) + '</p>';
  return h + '</div>';
}
function metaHtml(m){
  var t = m.meta; if(!t || t.tipo !== 'contagem') return '';
  var mes = nomeDoMes(m.competencia), h = '';
  var c = Number(t.contagem) || 0, lim = Number(t.ate_n), passou = c > lim, apos = brlCurto(t.valor_apos), ate = brlCurto(t.valor_ate);
  h = '<div class="meta"><div class="meta-h"><b>Sessões de plano</b><strong>' + c.toLocaleString('pt-BR') + '</strong>' +
        (passou ? '<em class="selo-ok">faixa de ' + apos + '</em>' : '<span>de ' + lim + '</span>') + '</div>' +
      '<div class="barra' + (passou ? ' ok' : '') + '" role="img" aria-label="' + c + ' de ' + lim + ' sessões de plano"><i style="width:' + Math.min(100, c / lim * 100) + '%"></i></div>';
  if(passou) h += '<p><b class="ok-txt">Você passou da ' + lim + 'ª.</b> ' + (m.completo ? plural(t.acima, 'sessão saiu', 'sessões saíram') : plural(t.acima, 'sessão já sai', 'sessões já saem')) + ' a ' + apos + '.</p>';
  else if(!m.completo && c === lim) h += '<p><b class="ok-txt">Você completou ' + lim + ' sessões de plano.</b> A partir da próxima, cada uma vale ' + apos + ' em vez de ' + ate + '.</p>';
  else if(!m.completo) h += '<p>Mais <b>' + plural(t.faltam, 'sessão', 'sessões') + '</b> de plano e você completa ' + lim + ': a partir da ' + (lim + 1) + 'ª, cada uma vale ' + apos + ' em vez de ' + ate + '.' +
                            (metaCabe(m, 'contagem') ? '' : ' Em ' + mesSeguinte(m.competencia) + ', a contagem recomeça do zero.') + '</p>';
  else h += '<p>O mês fechou com ' + plural(c, 'sessão', 'sessões') + ' de plano; a faixa de ' + apos + ' começa na ' + (lim + 1) + 'ª. Em ' + mesSeguinte(m.competencia) + ', a contagem recomeça do zero.</p>';
  return h + '</div>';
}
function dicasHtml(m){
  var t = (m.meta && m.meta.tipo === 'presenca') ? m.meta : null;
  return '<details class="mes-mais-info"><summary>Como subir a presença</summary><ul class="dicas">' +
    '<li><b>Consulta desmarcada por você conta como falta sua</b> e baixa a presença' + (t ? ', além de deixar ' + brlCurto(t.plano_baixo) + ' a ' + brlCurto(t.plano_alto) + ' de fora do mês' : '') + '. Quanto menos você desmarca, mais o mês rende.</li>' +
    '<li>Atendeu e aparece <b>Não compareceu</b>? Avise a recepção antes de confirmar: corrigido, conta como presença.</li></ul>' +
    '<p class="mes-nota">Presença = atendidos ÷ (atendidos + não compareceu).</p></details>';
}
function unTxt(l){ return l.valor_unit != null ? Number(l.quantidade).toLocaleString('pt-BR') + ' × ' + brlUnit(l.valor_unit) : plural(l.quantidade, 'sessão', 'sessões'); }
function contaHtml(m){
  var t = m.meta, piso = t && t.tipo === 'presenca' && !m.completo;
  var h = '<details class="mes-mais-info"><summary>Ver a conta</summary><table class="conta">';
  (m.linhas || []).forEach(function(l){
    h += '<tr><td>' + esc(l.descricao) + '<small>' + esc(unTxt(l)) + (l.regra ? ' · ' + esc(l.regra) : '') + '</small></td><td class="num">' + brl(l.valor) + '</td></tr>';
  });
  if(!(m.linhas || []).length) h += '<tr><td colspan="2">Nenhum atendimento pago no mês até agora.</td></tr>';
  h += '<tr class="tot"><td>Total</td><td class="num">' + brl(m.total) + '</td></tr></table>';
  if(piso) h += '<p class="mes-nota">Até o mês fechar, as sessões de plano entram a ' + brlCurto(t.plano_baixo) + '. Com ' + t.corte_pct + '% de presença no fim do mês, o recibo sai com ' + brlCurto(t.plano_alto) + '.</p>';
  return h + '</details>';
}
function notaMes(m, d){
  var mes = nomeDoMes(m.competencia);
  if(m.completo){
    if(m.recibo_gerado) return 'O recibo de ' + mes + ' já saiu: está logo abaixo, em Recibos de repasse.';
    return (fechaOMes(d) && (d.periodo_fim || d.semana_fim) === m.ate && d.aberta !== false) ? 'Confirme estes últimos dias e o recibo sai na hora, na tela e em PDF.'
         : 'O recibo de ' + mes + ' sai quando você confirmar os últimos dias do mês.';
  }
  if(d.motivo === 'antes_da_abertura' && d.abre_em) return 'O valor atualiza ' + fmtDiaHora(d.abre_em) + ', quando a próxima conferência abre. No dia 1º, você confirma os últimos dias do mês e o recibo sai na hora.';
  return 'O valor cresce toda segunda, quando a semana abre para conferência. No dia 1º, você confirma os últimos dias do mês e o recibo sai na hora.';
}
function mesHtml(m, d){
  var mes = cap(nomeDoMes(m.competencia));
  var tit = m.completo ? mes + (m.recibo_gerado ? ' fechado' : ' completo') : mes + ' até agora';
  var inc = incremento(m, d);
  return '<section class="mes" aria-label="O seu mês">' +
    '<div class="mes-h"><b>' + esc(tit) + '</b><span>' + ddmm(m.inicio) + ' a ' + ddmm(m.ate) + '</span></div>' +
    '<p class="mes-tot">' + brl(m.total) + '</p>' +
    '<p class="mes-sub">' + plural(m.atendidos, 'atendimento', 'atendimentos') + (m.so_unimed ? ' pela Unimed' : '') + '</p>' +
    (inc ? '<p class="mes-mais">+ ' + brl(inc.valor) + ' ' + esc(inc.rot) + '</p>' : '') +
    presencaHtml(m, d) +
    metaHtml(m) +
    (m.presenca && !m.completo ? dicasHtml(m) : '') +
    contaHtml(m) +
    '<p class="mes-nota">' + esc(notaMes(m, d)) + '</p></section>';
}

/* depois da selfie: o fim da conferência é um momento bom (regra do pico e do fim) */
var SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="square" aria-hidden="true"><path d="M5 12.5l4.6 4.5L19 7.5"/></svg>';
function sobeNumero(el){
  if(!el) return;
  var de = Number(el.getAttribute('data-de')), ate = Number(el.getAttribute('data-ate'));
  var calmo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!(ate > de) || calmo){ el.textContent = brl(ate); return; }
  var t0 = null, dur = 1300;
  var passo = function(t){
    if(t0 === null) t0 = t;
    var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = brl(de + (ate - de) * e);
    if(p < 1) requestAnimationFrame(passo);
  };
  setTimeout(function(){ requestAnimationFrame(passo); }, 380);
}
function confetes(){
  var cores = ['#B6569C', '#2C2D6E', '#1F7A3A', '#C65C9F', '#8C3484'], h = '';
  for(var k = 0; k < 18; k++){
    var a = (k / 18) * Math.PI * 2 + (k % 3) * 0.2, r = 78 + (k * 37 % 60);
    h += '<i style="--dx:' + Math.round(Math.cos(a) * r) + 'px;--dy:' + Math.round(Math.sin(a) * r * 0.8) + 'px;--r:' + (k * 47 % 360) + 'deg;background:' + cores[k % cores.length] + '"></i>';
  }
  return '<div class="confetes" aria-hidden="true">' + h + '</div>';
}
function semanaFesta(m, fechaMes, d0){   /* a semana que acabou de ser assinada: desmarcou alguém? e a sequência */
  var p = m.presenca; if(!p || p.semana_desmarcadas == null) return '';
  var sd = Number(p.semana_desmarcadas) || 0, sq = Number(p.sequencia) || 0, rot = fechaMes ? 'Nos últimos dias do mês' : (d0 && d0.periodo_especial ? 'Neste período' : 'Nesta semana');
  if(sd > 0) return '<p class="festa-meta">' + rot + ', você desmarcou <b>' + plural(sd, 'paciente', 'pacientes') + '</b>.' + (d0 && d0.periodo_especial ? '' : ' A sequência de semanas sem desmarcar recomeça.') + '</p>';
  if((m.atendidos || 0) + (m.faltas || 0) === 0) return '';
  return '<p class="festa-meta ok"><b>' + rot + ', você não desmarcou nenhum paciente.</b>' + (sq >= 2 ? ' São ' + sq + ' semanas seguidas.' : '') + '</p>';
}
function metaFesta(m){
  var p = m.presenca, t = m.meta, mes = nomeDoMes(m.competencia), h = '';
  if(p && p.pct != null){
    var corte = Number(p.meta), pos = t && t.tipo === 'presenca', q = pos ? Number(t.q_plano) || 0 : 0;
    if(m.completo) h = p.atingiu
      ? '<p class="festa-meta ok"><b>Meta de presença batida: ' + pctBr(m.pct) + '.</b>' + (pos && q ? ' ' + cap(sessoesPlano(q)) + ' saíram a ' + brlCurto(t.plano_alto) + ' (+ ' + brl(t.bonus) + ').' : '') + '</p>'
      : '<p class="festa-meta">Presença de ' + mes + ': ' + pctBr(m.pct) + ' (a meta era ' + corte + '%). Em ' + mesSeguinte(m.competencia) + ', a contagem recomeça do zero.</p>';
    else if(p.atingiu) h = '<p class="festa-meta ok"><b>Presença de ' + pctBr(m.pct) + ':</b> acima da meta de ' + corte + '%.' + (pos ? ' Mantendo assim, o mês vai a ' + brl(m.com_meta) + '.' : '') + '</p>';
    else h = '<p class="festa-meta">Presença de ' + pctBr(m.pct) + ': faltam ' + plural(p.seguidos, 'atendimento', 'atendimentos') + ' para ' + corte + '%' + (pos && q ? ', que leva o mês a ' + brl(m.com_meta) : '') + '.' +
             (metaCabe(m, 'presenca') ? '' : ' Em ' + mesSeguinte(m.competencia) + ', a contagem recomeça do zero.') + '</p>';
  }
  if(t && t.tipo === 'contagem'){
    var c = Number(t.contagem) || 0, lim = Number(t.ate_n);
    if(c > lim) h += '<p class="festa-meta ok"><b>' + plural(t.acima, 'sessão', 'sessões') + ' na faixa de ' + brlCurto(t.valor_apos) + '.</b></p>';
    else if(c === lim && !m.completo) h += '<p class="festa-meta ok"><b>' + lim + ' sessões de plano:</b> a próxima já vale ' + brlCurto(t.valor_apos) + '.</p>';
    else h += '<p class="festa-meta">' + c + ' de ' + lim + ' sessões de plano: ' + (m.completo || !metaCabe(m, 'contagem') ? 'em ' + mesSeguinte(m.competencia) + ', a contagem recomeça do zero.'
              : 'mais ' + plural(t.faltam, 'sessão', 'sessões') + ' e a ' + (lim + 1) + 'ª já vale ' + brlCurto(t.valor_apos) + '.') + '</p>';
  }
  return h;
}
function comemora(d0, m, conf){   /* d0: o período confirmado; m: o mês que estava na tela na hora da selfie (depois de confirmar o fim do mês,
                                     o cartão já pode ter virado para o mês novo); conf: a resposta da confirmação */
  if(!m) return;
  var fechaMes = fechaOMes(d0) && (d0.periodo_fim || d0.semana_fim) === m.ate, mes = nomeDoMes(m.competencia);
  var recibo = !!(m.recibo_gerado || (conf && conf.recibo_gerado));
  var ini = d0.periodo_inicio || d0.semana_inicio, fim = d0.periodo_fim || d0.semana_fim;
  var inc = (m.semana && m.semana.fim === fim) ? Number(m.semana.valor) : ((m.inicio === ini && m.ate === fim) ? Number(m.total) : 0);
  var bonus = (fechaMes && m.completo && m.meta && m.meta.tipo === 'presenca' && m.meta.atingiu) ? Number(m.meta.bonus) || 0 : 0;
  var de = Math.max(0, Number(m.total) - inc - bonus);
  var festa = bonus > 0 || (fechaMes && m.meta && m.meta.tipo === 'contagem' && m.meta.contagem > m.meta.ate_n);
  var atend = (m.semana && m.semana.fim === fim) ? m.semana.atendidos : m.atendidos;
  var corpo = '<div class="festa">' + (festa ? confetes() : '') +
    '<div class="selo-festa">' + SVG_CHECK + '</div>' +
    '<h2>' + (fechaMes ? cap(mes) + ' fechado' : 'Agenda assinada') + '</h2>' +
    '<p class="festa-sub">' + (fechaMes ? (recibo ? 'A agenda está confirmada e o seu recibo de repasse já saiu.' : 'A agenda do mês está confirmada.') : 'A sua selfie ficou registrada com a confirmação.') + '</p>' +
    '<div class="festa-bloco"><small>' + (fechaMes || m.completo ? 'Total de ' + mes : cap(mes) + ' até agora') + '</small>' +
      '<b class="festa-num" data-de="' + de + '" data-ate="' + Number(m.total) + '">' + brl(de) + '</b>' +
      (inc > 0 && de > 0 ? '<span>+ ' + brl(inc) + ' ' + (fechaMes ? 'nos últimos dias' : (d0.periodo_especial ? 'neste período' : 'nesta semana')) + ' · ' + plural(atend, 'atendimento', 'atendimentos') + '</span>'
       : '<span class="neutro">' + plural(m.atendidos, 'atendimento', 'atendimentos') + ' de ' + ddmm(m.inicio) + ' a ' + ddmm(m.ate) + '</span>') +
      semanaFesta(m, fechaMes, d0) + metaFesta(m) + '</div></div>';
  var botoes = (fechaMes && recibo) ? '<button type="button" class="btn" data-fecha>Fechar</button><button type="button" class="btn btn-pri" id="festa-recibo">Ver o recibo</button>'
                                               : '<button type="button" class="btn btn-pri" data-fecha>Fechar</button>';
  var f = folha(corpo, botoes, { classe: 'folha-festa' });
  sobeNumero(f.el.querySelector('.festa-num'));
  var vr = f.el.querySelector('#festa-recibo');
  if(vr) vr.onclick = function(){
    f.fecha();
    var alvo = ($('#a-recibo-area') && $('#a-recibo-area').firstChild) ? $('#a-recibo-area') : $('#a-recibos');
    if(alvo) setTimeout(function(){ alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  };
}

/* prévia do repasse — só no período que fecha o mês, para quem tem recibo (quando o banco ainda não tem o cartão do mês) */
function carregaPrevia(d){
  if(d.tipo_periodo !== 'fechamento_mes' || !d.regime || !d.regime.gera_recibo) return;
  rpc('prof_recibo_previa', { p_profissional_id: sess.id, p_senha: sess.senha, p_competencia: d.periodo_fim })
    .then(function(r){ previaAtual = r; $('#a-previa').innerHTML = previaHtml(r); })
    .catch(function(){ previaAtual = null; $('#a-previa').innerHTML = ''; });
}
function previaLinhas(r){
  return (r.resumo || []).map(function(x){
    var un = (x.quantidade > 0 && x.descricao !== 'Particular' && !/R\$/.test(x.descricao)) ? (x.quantidade + ' × ' + brl(x.valor / x.quantidade)) : (x.quantidade + (x.descricao === 'Particular' ? ' (sobre o valor cobrado)' : ''));
    return { descricao: x.descricao, un: un, valor: brl(x.valor) };
  });
}
function previaHtml(r){
  var h = '<div class="previa"><div class="previa-h"><b>Prévia do seu repasse de ' + esc(r.mes_nome) + '</b><span>muda com as correções · ainda não é o recibo</span></div>' +
    '<div class="previa-tot">' + brl(r.total) + '</div>' +
    '<p class="previa-sub">' + r.atendidos + (r.atendidos === 1 ? ' atendimento' : ' atendimentos') + ' e ' + r.faltas + (r.faltas === 1 ? ' falta' : ' faltas') +
      (r.mostra_pct ? '. Agenda: ' + esc(r.pct_texto) : '') + '</p><table>';
  previaLinhas(r).forEach(function(l){ h += '<tr><td>' + esc(l.descricao) + '</td><td class="un">' + esc(l.un) + '</td><td class="num">' + l.valor + '</td></tr>'; });
  if(!(r.resumo || []).length) h += '<tr><td colspan="3">Nenhum atendimento pago neste mês até agora.</td></tr>';
  return h + '</table><p class="previa-nota">Atendido é a sessão realizada. Falta é o cancelamento, o não comparecimento ou o agendamento não realizado. O recibo definitivo sai quando você confirma o mês.</p></div>';
}

/* recibos de repasse */
function renderRecibos(d){
  var box = $('#a-recibos'), lst = d.recibos || [];
  if(!lst.length){ box.innerHTML = ''; return; }
  box.innerHTML = '<h2 class="bloco-tit">Recibos de repasse</h2>' + lst.map(function(r){
    return '<div class="recibo-linha"><div><b>' + esc(nomeMes(r)) + '</b><span>' + brl(r.total) + (r.versao > 1 ? ' · versão ' + r.versao : '') + '</span></div>' +
      '<button type="button" class="btn" data-ver="' + esc(r.competencia) + '">Ver</button><button type="button" class="btn" data-pdf="' + esc(r.competencia) + '">PDF</button></div>';
  }).join('') + '<div id="a-recibo-area"></div>';
  var area = $('#a-recibo-area');
  var abre = function(comp, baixar){
    var pronto = (d.recibo && d.recibo.competencia === comp) ? Promise.resolve(d.recibo)
               : rpc('prof_recibo', { p_profissional_id: sess.id, p_senha: sess.senha, p_competencia: comp });
    pronto.then(function(r){ if(baixar) baixarRecibo(r); else { area.innerHTML = reciboHtml(r); area.scrollIntoView({ behavior: 'smooth', block: 'start' }); } })
          .catch(function(e){ if(SAIR_SE[e.message]) return sairCom(humano(e)); aviso(humano(e)); });
  };
  Array.prototype.forEach.call(box.querySelectorAll('[data-ver]'), function(b){ b.onclick = function(){ abre(b.getAttribute('data-ver'), false); }; });
  Array.prototype.forEach.call(box.querySelectorAll('[data-pdf]'), function(b){ b.onclick = function(){ abre(b.getAttribute('data-pdf'), true); }; });
  if(d.recibo && d.motivo === 'confirmada' && d.recibo.competencia === (d.presenca && d.presenca.mes)) area.innerHTML = reciboHtml(d.recibo);
}
function nomeMes(r){ if(r.mes_nome) return r.mes_nome; var d = dLocal(r.competencia); var m = MESES[d.getMonth()]; return m.charAt(0).toUpperCase() + m.slice(1) + ' de ' + d.getFullYear(); }
/* o recibo, igual na tela e no PDF (e no Cortex): valor unitário e regra em cada linha, presença com a conta,
   convênio em toda consulta, "Não compareceu" como na conferência e as conferências assinadas do mês.
   Recibo antigo (gerado antes do PROF v3.1) sai com o que ele tem. */
var RODAPE_RECIBO = 'Documento interno de repasse. Atendido: sessão realizada (inclui as lançadas como aguardando). Não compareceu: falta, desmarcação pelo paciente, cancelamento pelo profissional ou agendamento que não foi realizado. Remarcações não entram na conta.';
function reciboModelo(r){
  var novo = !!r.versao_calculo, so = r.so_unimed ? ' (somente Unimed)' : '', t = r.meta;
  var at = r.atendidos != null ? r.atendidos : r.finalizadas, fa = r.faltas || 0;
  var info = [['Profissional', r.profissional], ['Período', dmy(r.periodo_inicio) + ' a ' + dmy(r.periodo_fim)],
              ['Data de emissão', (r.emitido_em ? dataBr(r.emitido_em) : '—') + (r.versao > 1 ? ' (versão ' + r.versao + ')' : '')],
              ['Atendidos', String(at) + so]];
  var fp = r.faltas_por || null, dm = fp ? Number(fp.desmarcadas) || 0 : 0;
  if(r.faltas != null) info.push(['Não compareceu', String(fa) + so + (dm ? ' · ' + (dm === 1 ? '1 cancelada pelo profissional' : dm + ' canceladas pelo profissional') : '')]);
  if(novo && t && t.tipo === 'presenca') info.push(['Presença', pctBr(r.pct) + ' (' + at + ' de ' + (at + fa) + ' sessões) · mínimo de ' + t.corte_pct + '%: ' + (t.atingiu ? 'atingido' : 'não atingido')]);
  else if(!novo && r.mostra_pct) info.push(['Porcentagem de agenda', r.pct_texto]);
  var conf = (r.conferencias || []).map(function(c){ return ddmm(c.inicio) + ' a ' + ddmm(c.fim) + ' (' + (c.com_foto ? 'assinada' : 'confirmada') + ' em ' + ddmmTs(c.confirmado_em) + ')'; });
  if(conf.length) info.push(['Agenda conferida', conf.join(' · ')]);
  var resumo = (r.resumo || []).map(function(x){
    var un = x.valor_unit != null ? brlUnit(x.valor_unit)
           : (x.quantidade > 0 && x.descricao !== 'Particular' && Math.round(x.valor * 100) % x.quantidade === 0 ? brl(x.valor / x.quantidade) : '—');
    return { descricao: x.descricao, regra: x.regra || '', quantidade: String(x.quantidade), unitario: un, valor: brl(x.valor) };
  });
  var detalhe = (r.detalhe || []).map(function(x){
    var conv = x.convenio != null ? x.convenio + (x.categoria === 'ABA' && !/aba/i.test(x.convenio) ? ' · ABA' : '') : (x.descricao || '');
    return { data: dmy(x.data), horario: x.horario || '', paciente: x.paciente, convenio: conv, atendido: x.status === 'Atendido', situacao: x.status === 'Atendido' ? 'Atendido' : 'Não compareceu' };
  });
  return { info: info, resumo: resumo, detalhe: detalhe, total: brl(r.total) };
}
function reciboHtml(r){
  var M = reciboModelo(r);
  var h = '<div class="rc-card"><div class="rc-head"><svg class="rc-logo" viewBox="0 0 1756 1646" aria-hidden="true">' + LUAS + '</svg>' +
    '<div class="rc-quem"><b>Centro Médico Judithe Ferreira</b><span>Anápolis / GO · Área dos profissionais · Lev Soul</span></div>' +
    '<div class="rc-tit"><b>Recibo de repasse</b><span>' + esc(r.mes_nome) + '</span></div></div>' +
    '<div class="rc-info">' + M.info.map(function(i){ return '<div>' + esc(i[0]) + '</div><div>' + esc(i[1]) + '</div>'; }).join('') + '</div>' +
    '<div class="rc-sec">Resumo</div><div class="rc-rol"><table class="rc-t rc-res"><tr><th>Descrição</th><th class="num lg">Qtd.</th><th class="num lg">Valor unit.</th><th class="num">Valor</th></tr>';
  M.resumo.forEach(function(x){
    h += '<tr><td>' + esc(x.descricao) + '<small class="sm">' + esc(x.quantidade) + (x.unitario !== '—' ? ' × ' + esc(x.unitario) : (Number(x.quantidade) === 1 ? ' sessão' : ' sessões')) + '</small>' +
         (x.regra ? '<small>' + esc(x.regra) + '</small>' : '') + '</td><td class="num lg">' + esc(x.quantidade) + '</td><td class="num lg">' + esc(x.unitario) + '</td><td class="num">' + x.valor + '</td></tr>';
  });
  h += '<tr class="tot"><td>Total a receber</td><td class="lg"></td><td class="lg"></td><td class="num">' + M.total + '</td></tr></table></div>';
  h += '<div class="rc-sec">Detalhamento por paciente</div><div class="rc-rol"><table class="rc-t rc-det"><tr><th>Data</th><th>Horário</th><th>Paciente</th><th>Convênio</th><th>Situação</th></tr>';
  M.detalhe.forEach(function(x){
    h += '<tr><td>' + x.data + '</td><td>' + esc(x.horario) + '</td><td>' + esc(x.paciente) + '</td><td>' + esc(x.convenio) + '</td><td class="' + (x.atendido ? 'ok' : 'falta') + '">' + x.situacao + '</td></tr>';
  });
  return h + '</table></div><div class="rc-foot">' + RODAPE_RECIBO + '</div></div>';
}

/* ═══════════════ CAMADAS (folhas) ═══════════════ */
function fechaCamadas(){ $('#camadas').innerHTML = ''; document.body.style.overflow = ''; }
function folha(corpo, botoes, opcoes){
  opcoes = opcoes || {};
  var c = document.createElement('div'); c.className = 'camada';
  c.innerHTML = '<div class="folha' + (opcoes.classe ? ' ' + opcoes.classe : '') + '" role="dialog" aria-modal="true">' +
    (opcoes.semX ? '' : '<button type="button" class="fechar" aria-label="Fechar" data-fecha>×</button>') + corpo +
    (botoes ? '<div class="botoes">' + botoes + '</div>' : '') + '</div>';
  $('#camadas').appendChild(c); document.body.style.overflow = 'hidden';
  var fecha = function(){ if(c.parentNode) c.parentNode.removeChild(c); if(!$('#camadas').children.length) document.body.style.overflow = ''; if(opcoes.aoFechar) opcoes.aoFechar(); };
  c.addEventListener('click', function(e){ if(e.target === c && !opcoes.travada) fecha(); });
  Array.prototype.forEach.call(c.querySelectorAll('[data-fecha]'), function(b){ b.onclick = fecha; });
  var foco = c.querySelector('input:not([hidden])') || c.querySelector('button.btn-pri') || c.querySelector('button.btn'); if(foco && !ehCelular()) setTimeout(function(){ foco.focus(); }, 40);
  return { el: c, fecha: fecha };
}
function aviso(txt){ folha('<h2>Não deu certo</h2><p>' + esc(txt) + '</p>', '<button type="button" class="btn btn-pri" data-fecha>Entendi</button>'); }
document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  var ult = $('#camadas').lastElementChild; if(ult){ var x = ult.querySelector('[data-fecha]'); if(x) x.click(); }
  var mc = $('#a-menu-caixa'); if(!mc.hidden){ mc.hidden = true; $('#a-menu').setAttribute('aria-expanded', 'false'); }
});

/* ═══════════════ CONFIRMAR (com selfie, pelo celular) ═══════════════ */
function abreConfirmacao(d){
  if(!ehCelular()){
    folha('<h2>A confirmação é feita pelo celular</h2>' +
      '<p>Ela é assinada com uma <b>selfie tirada na hora</b>, pela câmera do celular.</p>' +
      '<p>Abra <b>profissionais.levsoul.com.br</b> no celular, entre com o seu e-mail e toque em <b>Está tudo certo — confirmar</b>.</p>',
      '<button type="button" class="btn btn-pri" data-fecha>Entendi</button>');
    return;
  }
  var m = folha('<h2>Confirmar a agenda</h2>' +
    '<label class="declara"><input type="checkbox" id="c-declaro"><span>Conferi consulta por consulta. Está tudo certo e <b>não há nenhuma correção pendente</b> na recepção.</span></label>' +
    '<p>' + (sess.fotoObrigatoria ? 'Tire uma selfie agora. <b>Ela é a sua assinatura</b> e fica registrada junto com a confirmação.' : 'Se quiser, tire uma selfie: ela vale como a sua assinatura.') + '</p>' +
    '<div class="foto"><input type="file" id="c-arquivo" accept="image/*" capture="' + FOTO_CAMERA + '" hidden>' +
      '<button type="button" class="btn" id="c-tirar">Tirar a selfie</button><img id="c-previa" alt="A sua selfie" hidden><small id="c-info" hidden></small></div>' +
    '<p class="erro" id="c-erro" hidden></p>',
    '<button type="button" class="btn" data-fecha>Voltar</button><button type="button" class="btn btn-pri" id="c-ok" disabled>Registrar confirmação</button>');
  var el = m.el, foto = null;
  var erro = function(t){ var e = $('#c-erro', el); e.textContent = t; e.hidden = !t; };
  var libera = function(){ $('#c-ok', el).disabled = (sess.fotoObrigatoria && !foto) || !$('#c-declaro', el).checked; };
  $('#c-declaro', el).onchange = libera;
  $('#c-tirar', el).onclick = function(){ $('#c-arquivo', el).click(); };
  $('#c-arquivo', el).onchange = function(ev){
    var f = ev.target.files && ev.target.files[0]; if(!f) return;
    erro('');
    comprimeFoto(f).then(function(res){
      foto = res;
      var img = $('#c-previa', el); img.src = res.dataUrl; img.hidden = false;
      var info = $('#c-info', el); info.textContent = 'Selfie pronta (' + Math.round(res.bytes / 1024) + ' KB).'; info.hidden = false;
      $('#c-tirar', el).textContent = 'Tirar outra selfie'; libera();
    }).catch(function(e){ erro('Não deu para preparar a foto: ' + e.message); });
  };
  $('#c-ok', el).onclick = function(){
    if(!$('#c-declaro', el).checked) return erro('Marque a declaração de que a agenda está correta.');
    if(sess.fotoObrigatoria && !foto) return erro(MSG.FOTO_OBRIGATORIA);
    var b = $('#c-ok', el); b.disabled = true; b.textContent = 'Registrando…';
    var antes = mesAtual;   /* o mês que estava na tela: é ele que a comemoração mostra */
    rpc('prof_confirmar_semana', { p_profissional_id: sess.id, p_senha: sess.senha, p_semana_inicio: d.semana_inicio,
        p_observacao: 'Declarou: conferiu consulta por consulta; nenhuma correção pendente na recepção.',
        p_foto_base64: foto ? foto.dataUrl : null, p_foto_mime: foto ? 'image/jpeg' : null })
      .then(function(resp){
        m.fecha(); window.scrollTo(0, 0);
        return carregar().then(function(){ if(sess.id && (antes || mesAtual)) comemora(d, antes || mesAtual, resp); });
      })
      .catch(function(e){
        if(SAIR_SE[e.message]){ m.fecha(); return sairCom(humano(e)); }
        erro(humano(e)); b.disabled = false; b.textContent = 'Registrar confirmação';
      });
  };
}
function comprimeFoto(file){
  return new Promise(function(resolve, reject){
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function(){
      try{
        var fator = Math.min(1, FOTO_LADO_MAX / Math.max(img.width, img.height));
        var w = Math.round(img.width * fator), h = Math.round(img.height * fator);
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        var q = FOTO_QUALIDADE, dataUrl = c.toDataURL('image/jpeg', q);
        while(dataUrl.length > 560 * 1024 * 4 / 3 && q > 0.35){ q -= 0.12; dataUrl = c.toDataURL('image/jpeg', q); }
        URL.revokeObjectURL(url);
        resolve({ dataUrl: dataUrl, bytes: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4) });
      }catch(e){ reject(e); }
    };
    img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error('imagem inválida')); };
    img.src = url;
  });
}

/* ═══════════════ PASSO A PASSO ═══════════════ */
var LUAS = document.querySelector('.topo-lua') ? document.querySelector('.topo-lua').innerHTML : '';   /* as duas luas da logo: a maior e a menor */
var SVG_LUAS = '<svg class="v-lua" viewBox="0 0 1756 1646" aria-hidden="true">' + LUAS + '</svg>';
var SVG_CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
var SVG_CADEADO = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><path d="M12 14.5v2.5"/></svg>';

function passos(){
  var d = atual || {}, lst = [];
  var esp = d.periodo_especial && d.tipo_periodo !== 'fechamento_mes';
  var semanal = d.tipo_periodo !== 'fechamento_mes' && d.abre_em;
  var abreDia = semanal ? diaSemana(d.abre_em) : 'segunda-feira', abreH = semanal ? horaCurta(d.abre_em) : '8h';
  /* v3.2: o passo a passo ensina a regra das semanas normais (prazo no mesmo dia da abertura);
     o prazo próprio de um período especial vai só na nota */
  var hSem = d.prazo_semanal_hora ? String(d.prazo_semanal_hora).split(':') : null;
  var prazoDia = semanal ? abreDia : (d.prazo ? diaSemana(d.prazo) : 'segunda-feira');
  var prazoH = hSem ? (hSem[1] === '00' ? Number(hSem[0]) + 'h' : Number(hSem[0]) + 'h' + hSem[1])
                    : (d.prazo ? horaCurta(d.prazo) : (sess.horaPrazo || '22h'));
  var espDiaPrazo = esp && d.prazo && diaSemana(d.prazo) !== abreDia;
  lst.push({ t: 'A sua agenda, conferida por você',
    p: 'Aqui você confere as consultas que fez na clínica e confirma que está tudo certo. É por essa agenda que a clínica fatura os atendimentos e calcula o seu repasse.',
    v: SVG_LUAS });
  lst.push({ t: 'Toda ' + prazoDia,
    p: (abreDia === prazoDia
         ? 'Às ' + abreH + ' da ' + abreDia.replace('-feira', '') + ', a agenda da semana anterior fica disponível aqui. Você tem até as ' + prazoH + ' do mesmo dia para conferir e confirmar.'
         : 'A partir de ' + abreDia + ', às ' + abreH + ', a agenda da semana anterior fica disponível aqui. O prazo para conferir e confirmar é ' + prazoDia + ', às ' + prazoH + '.'),
    nota: esp ? 'Nesta primeira vez, a conferência vai de ' + ddmm(d.periodo_inicio) + ' a ' + ddmm(d.periodo_fim) +
                (espDiaPrazo ? ', e o prazo é ' + diaSemana(d.prazo) + ' (' + ddmmTs(d.prazo) + '), às ' + horaCurta(d.prazo) +
                               '. Só desta vez. Nas próximas semanas, o prazo é sempre ' + abreDia + ', às ' + prazoH + '.' : '.') : '',
    v: '<div class="v-dia"><div><small>Abre</small><b>' + abreH + '</b></div><div><small>Prazo</small><b>' + prazoH + '</b></div></div>' });
  lst.push({ t: 'Confira consulta por consulta',
    p: 'Cada consulta aparece com o horário, o paciente, o convênio e a situação: Atendido ou Não compareceu. Remarcações não aparecem.',
    v: '<div class="v-cartao">' +
       '<div class="item"><span class="hora">08:00</span><span class="nome">Paciente exemplo</span><span class="conv">Unimed Local</span><span class="situ"><span class="chip ok">Atendido</span></span></div>' +
       '<div class="item"><span class="hora">09:00</span><span class="nome">Paciente exemplo</span><span class="conv">Particular</span><span class="situ"><span class="chip falta">Não compareceu</span></span></div></div>' });
  lst.push({ t: 'Achou algo errado?',
    p: 'Não confirme ainda. Avise a recepção pelo WhatsApp: ela corrige no sistema da clínica, e a correção aparece aqui até a manhã seguinte. Confira de novo e só confirme quando tudo estiver corrigido: depois de confirmada, a agenda não muda mais.',
    v: '<div class="v-balao"><b>Você, para a recepção</b>A consulta das 9h do dia 07/10 foi atendida, não foi falta.</div>' });
  lst.push({ t: 'Tudo certo? Confirme com uma selfie',
    p: 'Toque em “Está tudo certo — confirmar”, marque a declaração e tire uma selfie pelo celular. A selfie é a sua assinatura: é ela que registra que foi você quem confirmou.',
    v: '<div class="v-btn"><span class="btn btn-pri">Está tudo certo — confirmar</span><span class="v-selfie">' + SVG_CAMERA + '</span><span class="v-rot">A selfie é a sua assinatura</span></div>' });
  var mm = mesAtual, mt = mm && mm.meta, mp = mm && mm.presenca;
  if(mm){   /* o passo do mês mostra o mês de verdade de quem está lendo */
    var corteP = mp ? Number(mp.meta) : 70;
    var vis = '<div class="v-mes"><small>' + esc(cap(nomeDoMes(mm.competencia))) + (mm.completo ? ' completo' : ' até agora') + '</small><b>' + brl(mm.total) + '</b>' +
      (mp ? '<div class="barra' + (mp.atingiu ? ' ok' : '') + '"><i style="width:' + Math.min(100, Number(mm.pct || 0)) + '%"></i><em style="left:' + corteP + '%"></em></div><span>Presença ' + pctBr(mm.pct) + ' · meta ' + corteP + '%</span>'
       : '<span>' + plural(mm.atendidos, 'atendimento', 'atendimentos') + '</span>') + '</div>';
    var fecho = ' No dia 1º, você confirma os últimos dias e o recibo de repasse sai na hora, na tela e em PDF.';
    var presTxt = ' Você também vê a sua presença: a clínica espera ' + corteP + '%, e cada consulta que você desmarca conta como falta sua.';
    lst.push({ t: 'O seu mês, semana a semana',
      p: mt && mt.tipo === 'presenca'
           ? 'Toda segunda, o valor do seu mês cresce aqui, com as sessões de plano contadas a ' + brlCurto(mt.plano_baixo) + '. Feche o mês com ' + corteP + '% de presença ou mais e todas passam a ' + brlCurto(mt.plano_alto) + '. Cada consulta que você desmarca conta como falta sua.' + fecho
         : mt && mt.tipo === 'contagem'
           ? 'Toda segunda, o valor do seu mês cresce aqui. Até a ' + mt.ate_n + 'ª sessão de plano do mês, cada uma vale ' + brlCurto(mt.valor_ate) + '; a partir da ' + (mt.ate_n + 1) + 'ª, ' + brlCurto(mt.valor_apos) + '.' + presTxt + fecho
           : 'Toda segunda, o valor do seu mês cresce aqui, conforme a agenda da semana.' + presTxt + fecho,
      v: vis });
  } else if(d.regime && d.regime.gera_recibo){
    lst.push({ t: 'No fim do mês, o seu recibo',
      p: 'No dia 1º, você confirma os últimos dias do mês e o seu recibo de repasse sai na hora, na tela e em PDF. Antes de confirmar, você já vê a prévia do valor.',
      v: '<div class="v-recibo"><div class="v-recibo-h"><b>Recibo de repasse</b><span>Centro Médico Judithe Ferreira</span></div><p><span>Atendimentos</span><span>…</span></p><p><span>Faltas</span><span>…</span></p><p class="tot"><span>Total a receber</span><span>R$ …</span></p></div>' });
  }
  lst.push({ t: 'Confirmou, está registrado',
    p: 'Depois de confirmada, a agenda não muda mais por aqui. Se o prazo passar sem a sua confirmação, ela segue para o faturamento como está.',
    nota: 'Este passo a passo fica sempre em Menu → Como funciona.',
    v: '<div class="v-cadeado">' + SVG_CADEADO + '<span>Confirmado</span></div>' });
  return lst;
}
function tutorial(primeira){
  var lst = passos(), i = 0;
  var m = folha('<div class="tut-topo"><div class="fundo" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div class="tut-barra"></div><div class="tut-vis"></div></div>' +
    '<div class="tut-corpo"><p class="tut-n"></p><h2 class="tut-tit"></h2><p class="tut-p"></p><p class="tut-nota" hidden></p>' +
    '<div class="botoes"><button type="button" class="btn" data-voltar>Voltar</button><button type="button" class="btn btn-pri" data-prox>Próximo</button></div></div>',
    '', { classe: 'tut', travada: !!primeira });
  var el = m.el, folhaEl = el.querySelector('.folha');
  folhaEl.setAttribute('aria-label', 'Como funciona');
  var x = el.querySelector('.fechar'); if(x) x.style.cssText = 'color:#fff;z-index:4';
  var pinta = function(){
    var s = lst[i];
    el.querySelector('.tut-barra').innerHTML = lst.map(function(_, k){ return '<span' + (k <= i ? ' class="feito"' : '') + '></span>'; }).join('');
    el.querySelector('.tut-vis').innerHTML = s.v;
    el.querySelector('.tut-n').textContent = (i + 1) + ' de ' + lst.length;
    el.querySelector('.tut-tit').textContent = s.t;
    el.querySelector('.tut-p').textContent = s.p;
    var n = el.querySelector('.tut-nota'); n.textContent = s.nota || ''; n.hidden = !s.nota;
    var v = el.querySelector('[data-voltar]'); v.disabled = i === 0;
    el.querySelector('[data-prox]').textContent = i === lst.length - 1 ? (primeira ? 'Começar a conferir' : 'Fechar') : 'Próximo';
    folhaEl.scrollTop = 0;
  };
  el.querySelector('[data-voltar]').onclick = function(){ if(i > 0){ i--; pinta(); } };
  el.querySelector('[data-prox]').onclick = function(){
    if(i < lst.length - 1){ i++; pinta(); return; }
    m.fecha();
    if(primeira && !sess.tutorialVisto){
      rpc('prof_tutorial_visto', { p_profissional_id: sess.id, p_senha: sess.senha }).then(function(){ sess.tutorialVisto = true; }).catch(function(){});
    }
  };
  pinta();
}

/* ═══════════════ MENU · TROCAR SENHA ═══════════════ */
function trocarSenha(){
  var m = folha('<h2>Trocar minha senha</h2>' +
    '<input type="text" autocomplete="username" value="' + esc(sess.email || '') + '" hidden>' +
    '<label class="rot2" for="t-atual">Senha atual</label><input class="campo2" id="t-atual" type="password" autocomplete="current-password">' +
    '<label class="rot2" for="t-nova">Nova senha</label><input class="campo2" id="t-nova" type="password" autocomplete="new-password">' +
    '<label class="rot2" for="t-repete">Repita a nova senha</label><input class="campo2" id="t-repete" type="password" autocomplete="new-password">' +
    '<p class="erro" id="t-erro" hidden></p>',
    '<button type="button" class="btn" data-fecha>Voltar</button><button type="button" class="btn btn-pri" id="t-ok">Trocar a senha</button>');
  var el = m.el, erro = function(t){ var e = $('#t-erro', el); e.textContent = t; e.hidden = !t; };
  $('#t-ok', el).onclick = function(){
    var a = $('#t-atual', el).value, s1 = $('#t-nova', el).value, s2 = $('#t-repete', el).value; erro('');
    if(!a) return erro('Digite a sua senha atual.');
    if(s1.length < 4) return erro(MSG.SENHA_CURTA);
    if(s1 === '0000') return erro(MSG.SENHA_PROVISORIA);
    if(s1 !== s2) return erro('As duas senhas novas não estão iguais.');
    var b = $('#t-ok', el); b.disabled = true; b.textContent = 'Trocando…';
    rpc('prof_trocar_senha_email', { p_email: sess.email, p_senha_atual: a, p_senha_nova: s1 }).then(function(){
      sess.senha = s1; m.fecha();
      folha('<h2>Senha trocada</h2><p>Da próxima vez, entre com o seu e-mail e a senha nova.</p>', '<button type="button" class="btn btn-pri" data-fecha>Entendi</button>');
    }).catch(function(e){
      erro(e.message === 'LOGIN_INVALIDO' ? 'A senha atual não confere.' : humano(e));
      b.disabled = false; b.textContent = 'Trocar a senha';
    });
  };
}
function menu(abrir){
  var caixa = $('#a-menu-caixa'), btn = $('#a-menu');
  var vai = abrir == null ? caixa.hidden : abrir;
  caixa.hidden = !vai; btn.setAttribute('aria-expanded', vai ? 'true' : 'false');
  if(vai) caixa.querySelector('button').focus();
}

/* ═══════════════ PDF (jsPDF carregado só na hora) ═══════════════
   Cabeçalho com a logo nas cores da marca (lua maior índigo, lua menor orquídea), o nome da clínica
   e o tipo do documento; rodapé com a emissão e a página. A prévia continua marcada como
   demonstrativo em todas as páginas; o comprovante traz a selfie como assinatura. */
var COR = { indigo: [44, 45, 110], orq: [182, 86, 156], tinta: [29, 29, 31], cinza: [107, 104, 120], linha: [223, 219, 231],
            lavanda: [244, 242, 248], verde: [31, 122, 58], vermelho: [179, 38, 30], ambar: [122, 90, 0] };
var URL_PDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
var URL_TABELA = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
function carregaScript(src, pronto){
  return new Promise(function(resolve, reject){
    if(pronto()) return resolve();
    var sc = document.createElement('script'); sc.src = src;
    sc.onload = function(){ pronto() ? resolve() : reject(new Error('não carregou ' + src)); };
    sc.onerror = function(){ reject(new Error('sem internet para baixar o gerador de PDF')); };
    document.head.appendChild(sc);
  });
}
function carregaPdf(){
  return carregaScript(URL_PDF, function(){ return !!(window.jspdf && window.jspdf.jsPDF); }).then(function(){
    var J = window.jspdf.jsPDF;
    return carregaScript(URL_TABELA, function(){ return !!(J.API && J.API.autoTable); }).then(function(){ return J; });
  });
}
var logoPromessa = null;
function logoPng(){   /* a logo (as duas luas) vira imagem uma vez só; sem ela, o PDF sai assim mesmo */
  if(logoPromessa) return logoPromessa;
  logoPromessa = new Promise(function(resolve){
    var p = LUAS.match(/d="[^"]+"/g) || [];
    if(p.length < 2) return resolve(null);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1756 1646"><path fill="#2C2D6E" ' + p[0] + '/><path fill="#B6569C" ' + p[1] + '/></svg>';
    var img = new Image();
    img.onload = function(){
      try{ var c = document.createElement('canvas'); c.width = 527; c.height = 494; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL('image/png')); }
      catch(e){ resolve(null); }
    };
    img.onerror = function(){ resolve(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  return logoPromessa;
}
function dataBr(iso){ return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }); }
function dataHoraBr(iso){ return dataBr(iso) + ' às ' + new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); }
function cor(doc, qual, c){ doc['set' + qual + 'Color'](c[0], c[1], c[2]); }

/* folha A4: cabeçalho completo na 1ª página e discreto nas outras, marca d'água opcional, rodapé numerado */
function novoPdf(jsPDF, titulo, subtitulo, logo, demonstrativo){
  var doc = new jsPDF({ unit: 'mm', format: 'a4' }), M = 16, L = 194, feitas = {};
  var marca = function(){
    if(!demonstrativo) return;
    try{ doc.setGState(new doc.GState({ opacity: 0.13 })); }catch(e){}
    cor(doc, 'Text', [215, 60, 60]); doc.setFont('helvetica', 'bold');
    doc.setFontSize(46); doc.text('DEMONSTRATIVO', 105, 165, { align: 'center', angle: 35 });
    doc.setFontSize(19); doc.text('AGENDA AINDA NÃO CONFIRMADA', 105, 180, { align: 'center', angle: 35 });
    try{ doc.setGState(new doc.GState({ opacity: 1 })); }catch(e){}
  };
  var cabecalho = function(){
    var pg = doc.internal.getCurrentPageInfo().pageNumber;
    if(feitas[pg]) return null;
    feitas[pg] = true; marca();
    var primeira = pg === 1, y0 = 12;
    if(logo) doc.addImage(logo, 'PNG', M, y0, primeira ? 14 : 8.5, primeira ? 13.1 : 8);
    var x = M + (primeira ? 18 : 11.5);
    cor(doc, 'Text', COR.indigo); doc.setFont('helvetica', 'bold'); doc.setFontSize(primeira ? 13 : 9.5);
    doc.text('Centro Médico Judithe Ferreira', x, y0 + (primeira ? 5.6 : 3.6));
    cor(doc, 'Text', COR.cinza); doc.setFont('helvetica', 'normal'); doc.setFontSize(primeira ? 8.5 : 7.5);
    doc.text(primeira ? 'Anápolis / GO · Área dos profissionais · Lev Soul' : titulo + (subtitulo ? ' · ' + subtitulo : ''), x, y0 + (primeira ? 10.6 : 7.4));
    if(primeira){
      cor(doc, 'Text', COR.indigo); doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5);
      doc.text(titulo, L, y0 + 5.6, { align: 'right' });
      if(subtitulo){ cor(doc, 'Text', COR.cinza); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(subtitulo, L, y0 + 10.6, { align: 'right' }); }
    }
    var yl = y0 + (primeira ? 16.5 : 11);
    cor(doc, 'Draw', COR.orq); doc.setLineWidth(0.6); doc.line(M, yl, L, yl);
    cor(doc, 'Text', COR.tinta);
    return yl + 7;
  };
  var rodape = function(extra){
    var n = doc.internal.getNumberOfPages(), quando = dataHoraBr(new Date().toISOString());
    for(var i = 1; i <= n; i++){
      doc.setPage(i);
      cor(doc, 'Draw', COR.linha); doc.setLineWidth(0.2); doc.line(M, 283, L, 283);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); cor(doc, 'Text', COR.cinza);
      doc.text('Emitido em ' + quando + ' · profissionais.levsoul.com.br', M, 288);
      doc.text('Página ' + i + ' de ' + n, L, 288, { align: 'right' });
      if(extra){ doc.setFont('helvetica', 'bold'); cor(doc, 'Text', COR.vermelho); doc.text(extra, 105, 293, { align: 'center' }); }
    }
  };
  var tabela = function(op){   /* o cabeçalho das páginas seguintes ocupa até 30 mm */
    op.margin = Object.assign({ left: M, right: 210 - L, top: 31, bottom: 20 }, op.margin || {});
    op.willDrawPage = function(){ cabecalho(); };
    var antes = op.didParseCell;
    op.didParseCell = function(dd){   /* título da coluna alinhado como os valores (números à direita) */
      if(dd.section === 'head'){ var cs = (op.columnStyles || {})[dd.column.index]; if(cs && cs.halign) dd.cell.styles.halign = cs.halign; }
      if(antes) antes(dd);
    };
    doc.autoTable(op);
    return doc.lastAutoTable.finalY;
  };
  var titulo2 = function(txt, y){
    if(y > 258){ doc.addPage(); y = cabecalho(); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); cor(doc, 'Text', COR.indigo); doc.text(txt, M, y);
    cor(doc, 'Text', COR.tinta);
    return y + 3;
  };
  return { doc: doc, M: M, L: L, W: L - M, cabecalho: cabecalho, rodape: rodape, tabela: tabela, titulo2: titulo2 };
}

/* recibo de repasse — mesmo conteúdo e ordem do recibo oficial, com a cara nova */
/* tabela do resumo com a regra do preço em letra menor, embaixo da descrição */
function tabelaResumo(P, y, linhas, total){
  var doc = P.doc, LH = 9.5 * 1.15 * 25.4 / 72, LHr = 7.6 * 1.2 * 25.4 / 72, larg = 96 - 4;
  var regras = linhas.map(function(z){ doc.setFontSize(7.6); return z.regra ? doc.splitTextToSize(z.regra, larg) : []; });
  var corpo = linhas.map(function(z){ return [z.descricao, z.quantidade, z.unitario, z.valor]; });
  corpo.push([{ content: 'TOTAL A RECEBER', styles: { fontStyle: 'bold', fillColor: COR.lavanda, textColor: COR.indigo } },
              { content: '', styles: { fillColor: COR.lavanda } }, { content: '', styles: { fillColor: COR.lavanda } },
              { content: total, styles: { fontStyle: 'bold', fillColor: COR.lavanda, textColor: COR.indigo, halign: 'right' } }]);
  return P.tabela({ startY: y, theme: 'grid', head: [['Descrição', 'Qtd.', 'Valor unit.', 'Valor']], body: corpo,
    headStyles: { fillColor: COR.indigo, textColor: 255, fontStyle: 'bold', fontSize: 9.5 },
    styles: { fontSize: 9.5, cellPadding: 2, lineColor: COR.linha, lineWidth: 0.2, textColor: COR.tinta, valign: 'top' },
    columnStyles: { 0: { cellWidth: 96 }, 1: { cellWidth: 18, halign: 'right' }, 2: { cellWidth: 30, halign: 'right' }, 3: { cellWidth: 34, halign: 'right' } },
    didParseCell: function(dd){
      if(dd.section !== 'body' || dd.column.index !== 0 || !regras[dd.row.index] || !regras[dd.row.index].length) return;
      var desc = doc.splitTextToSize(String(linhas[dd.row.index].descricao), larg), n = regras[dd.row.index].length;
      dd.cell.text = desc; dd.cell.styles.minCellHeight = 4 + desc.length * LH + n * LHr + 0.8;
    },
    didDrawCell: function(dd){
      if(dd.section !== 'body' || dd.column.index !== 0 || !regras[dd.row.index] || !regras[dd.row.index].length) return;
      var desc = doc.splitTextToSize(String(linhas[dd.row.index].descricao), larg);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); cor(doc, 'Text', COR.cinza);
      doc.text(regras[dd.row.index], dd.cell.x + 2, dd.cell.y + 2 + desc.length * LH + LHr * 0.85);
      doc.setFontSize(9.5); cor(doc, 'Text', COR.tinta);
    } });
}
function baixarRecibo(r){
  Promise.all([carregaPdf(), logoPng()]).then(function(x){
    var P = novoPdf(x[0], 'Recibo de repasse', r.mes_nome, x[1], false), doc = P.doc, M = P.M, R = reciboModelo(r);
    var y = P.cabecalho();
    y = P.tabela({ startY: y, theme: 'grid', body: R.info,
      styles: { fontSize: 9.5, cellPadding: 2, lineColor: COR.linha, lineWidth: 0.2, textColor: COR.tinta },
      columnStyles: { 0: { cellWidth: 44, fontStyle: 'bold', fillColor: COR.lavanda, textColor: COR.indigo } } }) + 10;
    y = P.titulo2('Resumo', y);
    y = tabelaResumo(P, y, R.resumo, R.total) + 10;
    y = P.titulo2('Detalhamento por paciente', y);
    var det = R.detalhe.map(function(z){
      return [z.data, z.horario, z.paciente, z.convenio, { content: z.situacao, styles: { fontStyle: 'bold', textColor: z.atendido ? COR.verde : COR.vermelho } }];
    });
    y = P.tabela({ startY: y, theme: 'grid', head: [['Data', 'Horário', 'Paciente', 'Convênio', 'Situação']], body: det,
      headStyles: { fillColor: COR.indigo, textColor: 255, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8.5, cellPadding: 1.6, lineColor: COR.linha, lineWidth: 0.2, textColor: COR.tinta },
      alternateRowStyles: { fillColor: [250, 249, 252] },
      columnStyles: { 0: { cellWidth: 21 }, 1: { cellWidth: 16 }, 2: { cellWidth: 70 }, 3: { cellWidth: 42 }, 4: { cellWidth: 29 } } }) + 7;
    if(y > 266){ doc.addPage(); y = P.cabecalho(); }
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); cor(doc, 'Text', COR.cinza);
    doc.text(doc.splitTextToSize(RODAPE_RECIBO, P.W), M, y);
    P.rodape(null);
    doc.save('Recibo ' + String(r.mes_nome).replace(' / ', ' ') + ' - ' + r.profissional + '.pdf');
  }).catch(function(e){ aviso('Não deu para gerar o PDF: ' + e.message); });
}

/* prévia (antes de confirmar) e comprovante (depois) da conferência */
function baixarRelatorio(d, btn){
  var txt0 = btn ? btn.textContent : ''; if(btn){ btn.disabled = true; btn.textContent = 'Gerando o PDF…'; }
  Promise.all([carregaPdf(), logoPng()]).then(function(x){
    var previa = !d.confirmada_em, itens = d.itens || [], nome = nomeBonito(d.nome || sess.nome || '');
    var ini = d.periodo_inicio || d.semana_inicio, fim = d.periodo_fim || d.semana_fim;
    var P = novoPdf(x[0], 'Conferência de agenda', (d.periodo_especial ? 'Período de ' : 'Semana de ') + dmy(ini) + ' a ' + dmy(fim), x[1], previa);
    var doc = P.doc, M = P.M, W = P.W;
    var y = P.cabecalho();
    cor(doc, 'Fill', previa ? COR.vermelho : COR.verde); doc.rect(M, y - 5, W, 10, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.text(previa ? 'DOCUMENTO DEMONSTRATIVO — AGENDA AINDA NÃO CONFIRMADA PELO PROFISSIONAL'
                    : 'AGENDA CONFIRMADA EM ' + dataHoraBr(d.confirmada_em).toUpperCase() + (d.confirmada_com_foto ? ' · ASSINADA COM SELFIE' : ''), 105, y + 1.4, { align: 'center' });
    y += 11;
    y = P.tabela({ startY: y, theme: 'plain', body: [
        ['Profissional', nome],
        [d.periodo_especial ? 'Período' : 'Semana', dmy(ini) + ' a ' + dmy(fim)],
        ['Consultas', String(itens.length)],
        ['Situação', previa ? 'Prévia, ainda não confirmada (sem valor de confirmação)' : 'Confirmada em ' + dataHoraBr(d.confirmada_em)],
        ['Assinatura', previa ? 'Ainda não assinada' : (d.confirmada_com_foto ? 'Selfie tirada na confirmação, guardada no sistema da clínica' : 'Confirmada sem selfie')]],
      styles: { fontSize: 9.5, cellPadding: { top: 1.3, bottom: 1.3, left: 0, right: 3 }, textColor: COR.tinta },
      columnStyles: { 0: { cellWidth: 30, fontStyle: 'bold', textColor: COR.indigo } } }) + 8;
    var mp = (previa && fechaOMes(d) && mesAtual && mesAtual.completo) ? mesAtual : null;
    if(mp || (previa && previaAtual && previaAtual.previa)){
      var rp = mp || previaAtual;
      y = P.titulo2('Prévia do repasse — ' + rp.mes_nome, y);
      var corpo = mp ? (mp.linhas || []).map(function(l){ return [l.descricao, unTxt(l), brl(l.valor)]; })
                     : previaLinhas(rp).map(function(l){ return [l.descricao, l.un, l.valor]; });
      corpo.push([{ content: 'Total (prévia)', styles: { fontStyle: 'bold' } }, '', { content: brl(rp.total), styles: { fontStyle: 'bold', halign: 'right' } }]);
      y = P.tabela({ startY: y, theme: 'plain', head: [['Descrição', 'Quantidade', 'Valor']], body: corpo,
        headStyles: { fillColor: COR.lavanda, textColor: COR.indigo, fontStyle: 'bold', fontSize: 9 },
        styles: { fontSize: 9, cellPadding: 1.6, textColor: COR.tinta, lineColor: COR.linha, lineWidth: { bottom: 0.15 } },
        columnStyles: { 1: { cellWidth: 46, textColor: COR.cinza }, 2: { cellWidth: 32, halign: 'right' } } }) + 4;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cor(doc, 'Text', COR.cinza);
      doc.text(mp ? plural(mp.atendidos, 'atendido', 'atendidos') + ' · ' + plural(mp.faltas, 'não compareceu', 'não compareceram') +
                    (mp.meta && mp.meta.tipo === 'presenca' ? ' · presença ' + pctBr(mp.pct) + ' (mínimo ' + mp.meta.corte_pct + '%)' : '') + ' · muda com as correções; não é o recibo.'
                  : rp.atendidos + ' atendimentos e ' + rp.faltas + ' faltas' + (rp.mostra_pct ? ' · agenda ' + rp.pct_texto : '') + ' · muda com as correções; não é o recibo.', M, y);
      y += 9;
    }
    y = P.titulo2('Agenda', y);
    var porDia = {}, ordem = [];
    itens.forEach(function(i){ if(!porDia[i.data]){ porDia[i.data] = []; ordem.push(i.data); } porDia[i.data].push(i); });
    var linhas = [];
    ordem.forEach(function(data){
      var dt = dLocal(data), fer = porDia[data].some(function(i){ return i.em_feriado; });
      linhas.push([{ content: DIAS[dt.getDay()] + ', ' + dmy(data) + (fer ? ' — feriado' : ''), colSpan: 4, styles: { fillColor: COR.lavanda, textColor: COR.indigo, fontStyle: 'bold' } }]);
      porDia[data].forEach(function(it){
        var c = classeStatus(it);
        linhas.push([hhmm(it.horario) || '—', it.paciente ? nomeBonito(it.paciente) : '(sem paciente)', it.convenio || '',
          { content: it.status_exibido || it.status || '', styles: { fontStyle: 'bold', textColor: c === 'ok' ? COR.verde : c === 'falta' ? COR.vermelho : c === 'feriado' ? COR.ambar : COR.cinza } }]);
      });
    });
    if(!linhas.length) linhas.push([{ content: 'Nenhuma consulta no período.', colSpan: 4 }]);
    y = P.tabela({ startY: y, theme: 'plain', head: [['Horário', 'Paciente', 'Convênio', 'Situação']], body: linhas,
      headStyles: { fillColor: COR.indigo, textColor: 255, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 1.7, textColor: COR.tinta, lineColor: COR.linha, lineWidth: { bottom: 0.15 } },
      columnStyles: { 0: { cellWidth: 17 }, 2: { cellWidth: 42 }, 3: { cellWidth: 32, halign: 'right' } } }) + 10;
    if(y > 262){ doc.addPage(); y = P.cabecalho(); }
    cor(doc, 'Draw', previa ? COR.linha : COR.verde); doc.setLineWidth(0.3); doc.rect(M, y - 5, W, 15);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); cor(doc, 'Text', previa ? COR.cinza : COR.verde);
    doc.text(previa ? 'Sem assinatura: este documento é uma prévia.' : 'Assinada com selfie por ' + nome + ' em ' + dataHoraBr(d.confirmada_em) + '.', M + 4, y + 0.8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); cor(doc, 'Text', COR.cinza);
    doc.text(previa ? 'Para confirmar, toque em "Está tudo certo — confirmar" pelo celular e tire uma selfie, que é a sua assinatura.'
                    : 'A selfie é a assinatura da confirmação e fica guardada no sistema da clínica.', M + 4, y + 6);
    P.rodape(previa ? 'PRÉVIA — SEM VALOR DE CONFIRMAÇÃO' : null);
    doc.save((previa ? 'previa_' : 'conferencia_') + (d.nome || 'profissional').replace(/[^a-z0-9]+/gi, '_') + '_' + d.semana_inicio + '.pdf');
  }).catch(function(e){ aviso('Não deu para gerar o PDF: ' + e.message); })
    .then(function(){ if(btn){ btn.disabled = false; btn.textContent = txt0; } });
}

/* ═══════════════ LIGAÇÕES ═══════════════ */
function liga(){
  $('#f-entrar').addEventListener('submit', entrar);
  $('#f-senha').addEventListener('submit', criarSenha);
  $('#e-esqueci').onclick = esqueci;
  $('#s-voltar').onclick = function(){ prov = { email: null, senha: null, nome: null }; mostraPorta('entrar'); };
  $('#a-menu').onclick = function(e){ e.stopPropagation(); menu(); };
  document.addEventListener('click', function(e){
    var mc = $('#a-menu-caixa');
    if(!mc.hidden && !mc.contains(e.target)) menu(false);
    var t = e.target.closest && e.target.closest('[data-tutorial]'); if(t) tutorial(false);
  });
  $('#a-menu-caixa').addEventListener('click', function(e){
    var b = e.target.closest('button[data-acao]'); if(!b) return;
    menu(false);
    var a = b.getAttribute('data-acao');
    if(a === 'tutorial') tutorial(false);
    else if(a === 'senha') trocarSenha();
    else if(a === 'sair') location.reload();
  });
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible' && sess.id && atual && !$('#camadas').children.length) pintaFaixa(atual);
  });
  $('#e-email').value = lembrado();
  mostraPorta('entrar');
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', liga); else liga();

/* só para os testes automáticos da tela (não mexe em nada do sistema) */
window.__prof = { sess: function(){ return sess; } };
})();
