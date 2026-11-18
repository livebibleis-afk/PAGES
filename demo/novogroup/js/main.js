document.addEventListener('DOMContentLoaded', () => {
  // Configuración pública de contacto (dejar null hasta confirmación oficial de Exel)
  const WHATSAPP_CONFIRMADO = '51961205510';

  // 1. Menú de navegación en celular
  const menuBtn = document.querySelector('[data-menu-toggle]');
  const navMenu = document.querySelector('[data-menu-list]');

  if (menuBtn && navMenu) {
    menuBtn.addEventListener('click', () => {
      const isExpanded = menuBtn.getAttribute('aria-expanded') === 'true';
      const nextState = !isExpanded;
      menuBtn.setAttribute('aria-expanded', String(nextState));
      menuBtn.setAttribute(
        'aria-label',
        nextState ? 'Cerrar menú de navegación' : 'Abrir menú de navegación'
      );
      navMenu.classList.toggle('is-open', nextState);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menuBtn.getAttribute('aria-expanded') === 'true') {
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.setAttribute('aria-label', 'Abrir menú de navegación');
        navMenu.classList.remove('is-open');
        menuBtn.focus();
      }
    });
  }

  // 2. Validación accesible del formulario de contacto (en cliente)
  const contactForm = document.getElementById('formulario-contacto');

  const esMedioContactoValido = (valor) => {
    const limpio = valor.trim();
    if (!limpio) return false;
    const regexCorreo = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const soloDigitos = limpio.replace(/[\s\-+()]/g, '');
    const regexTelefono = /^\d{7,15}$/;
    return regexCorreo.test(limpio) || regexTelefono.test(soloDigitos);
  };

  const mostrarErrorCampo = (inputEl, errorEl, mensajeError) => {
    if (!inputEl || !errorEl) return;
    if (mensajeError) {
      inputEl.setAttribute('aria-invalid', 'true');
      errorEl.textContent = mensajeError;
      errorEl.hidden = false;
    } else {
      inputEl.setAttribute('aria-invalid', 'false');
      errorEl.textContent = '';
      errorEl.hidden = true;
    }
  };

  if (contactForm) {
    const inputNombre = document.getElementById('nombre');
    const inputMedio = document.getElementById('medio-contacto');
    const selectTipo = document.getElementById('tipo-consulta');
    const inputMensaje = document.getElementById('mensaje');
    const feedbackBox = document.getElementById('estado-formulario');

    const errorNombre = document.getElementById('error-nombre');
    const errorMedio = document.getElementById('error-medio-contacto');
    const errorTipo = document.getElementById('error-tipo-consulta');
    const errorMensaje = document.getElementById('error-mensaje');

    const validarFormulario = () => {
      let primerInvalido = null;

      const nombreVal = inputNombre.value.trim();
      if (nombreVal.length < 2) {
        mostrarErrorCampo(
          inputNombre,
          errorNombre,
          'Por favor, ingresa tu nombre y apellido (al menos 2 caracteres).'
        );
        primerInvalido = primerInvalido || inputNombre;
      } else {
        mostrarErrorCampo(inputNombre, errorNombre, '');
      }

      const medioVal = inputMedio.value.trim();
      if (!esMedioContactoValido(medioVal)) {
        mostrarErrorCampo(
          inputMedio,
          errorMedio,
          'Ingresa un teléfono válido (mínimo 7 dígitos) o un correo electrónico con formato nombre@dominio.pe.'
        );
        primerInvalido = primerInvalido || inputMedio;
      } else {
        mostrarErrorCampo(inputMedio, errorMedio, '');
      }

      const tipoVal = selectTipo.value.trim();
      if (!tipoVal) {
        mostrarErrorCampo(
          selectTipo,
          errorTipo,
          'Selecciona el tipo de consulta para dirigir tu mensaje al área adecuada.'
        );
        primerInvalido = primerInvalido || selectTipo;
      } else {
        mostrarErrorCampo(selectTipo, errorTipo, '');
      }

      const mensajeVal = inputMensaje.value.trim();
      if (mensajeVal.length < 10) {
        mostrarErrorCampo(
          inputMensaje,
          errorMensaje,
          'Escribe un mensaje un poco más detallado (mínimo 10 caracteres).'
        );
        primerInvalido = primerInvalido || inputMensaje;
      } else {
        mostrarErrorCampo(inputMensaje, errorMensaje, '');
      }

      return {
        esValido: !primerInvalido,
        primerInvalido,
        datos: {
          nombre: nombreVal,
          medio: medioVal,
          tipo: tipoVal,
          mensaje: mensajeVal
        }
      };
    };

    [inputNombre, inputMedio, selectTipo, inputMensaje].forEach((campo) => {
      if (!campo) return;
      campo.addEventListener('input', () => {
        if (campo.getAttribute('aria-invalid') === 'true') {
          validarFormulario();
        }
      });
    });

    contactForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const resultado = validarFormulario();

      if (!resultado.esValido) {
        feedbackBox.className = 'form-feedback is-error';
        feedbackBox.innerHTML =
          '<p class="form-feedback-title">Revisa los campos marcados en rojo antes de continuar.</p>' +
          '<p>Corrige las indicaciones mostradas debajo de cada campo obligatorio.</p>';
        feedbackBox.hidden = false;
        resultado.primerInvalido.focus();
        return;
      }

      const { nombre, medio, tipo, mensaje } = resultado.datos;
      const resumenTexto = `Hola, soy ${nombre}. Mi consulta es sobre ${tipo}: ${mensaje} (Contacto: ${medio}).`;

      feedbackBox.className = 'form-feedback is-success';
      feedbackBox.innerHTML = '';

      const titulo = document.createElement('p');
      titulo.className = 'form-feedback-title';
      titulo.textContent = 'Consulta validada y lista en tu dispositivo';

      const detalle = document.createElement('p');
      detalle.textContent = `Resumen preparado para ${nombre} (${tipo}).`;

      const estadoCanal = document.createElement('p');
      if (WHATSAPP_CONFIRMADO) {
        const urlWa = `https://wa.me/${WHATSAPP_CONFIRMADO}?text=${encodeURIComponent(resumenTexto)}`;
        const linkWa = document.createElement('a');
        linkWa.className = 'btn btn-primary';
        linkWa.href = urlWa;
        linkWa.target = '_blank';
        linkWa.rel = 'noopener noreferrer';
        linkWa.textContent = 'Continuar y enviar por WhatsApp';
        estadoCanal.appendChild(linkWa);
      } else {
        estadoCanal.innerHTML =
          'El envío directo se activará en cuanto se confirme el número oficial de WhatsApp (<span class="placeholder-marker">[Confirmar WhatsApp]</span>). Mientras tanto, puedes usar el asistente de chat o copiar el texto de tu consulta.';
      }

      feedbackBox.appendChild(titulo);
      feedbackBox.appendChild(detalle);
      feedbackBox.appendChild(estadoCanal);
      feedbackBox.hidden = false;
      feedbackBox.focus();
    });
  }

  // 3. Widget de chat orientativo en el cliente (sin servidores ni cuentas de terceros)
  const respuestasOrientativas = {
    cirugias:
      'Para una cirugía programada te pediremos tus exámenes preoperatorios, tu evaluación de riesgo quirúrgico y cumplir el ayuno que indique tu médico. Puedes revisar los pasos en la sección Cirugías.',
    uci:
      'Nuestra UCI cuenta con vigilancia médica y de enfermería las 24 horas. El informe médico se brinda directamente al familiar responsable acreditado en los horarios establecidos.',
    hospitalizacion:
      'Durante la hospitalización supervisamos tu recuperación posoperatoria, medicación y dieta médica. Al alta entregamos tu receta y el informe médico (epicrisis).',
    contacto:
      'Puedes llamar o escribir por WhatsApp a Admisión al +51 961 205 510, o dejar tu mensaje en el formulario de Contacto.'
  };

  const crearWidgetChat = () => {
    const contenedor = document.createElement('aside');
    contenedor.className = 'chat-widget';
    contenedor.setAttribute('aria-label', 'Asistente de orientación en línea');

    contenedor.innerHTML = `
      <div class="chat-panel" id="panel-chat-orientacion" role="dialog" aria-modal="false" aria-labelledby="titulo-chat-widget" hidden>
        <div class="chat-header">
          <div>
            <p class="chat-header-title" id="titulo-chat-widget">Orientación al paciente</p>
            <p class="chat-header-subtitle">Asistente informativo en tu navegador</p>
          </div>
          <button class="chat-close-btn" type="button" data-chat-close aria-label="Cerrar panel de chat">
            Cerrar
          </button>
        </div>
        <div class="chat-messages" id="chat-mensajes" aria-live="polite">
          <div class="chat-bubble chat-bubble-bot">
            Hola. Soy el asistente informativo de la Clínica Quirúrgica Novo Group. Elige un tema o escribe tu consulta para orientarte.
          </div>
        </div>
        <div class="chat-quick-topics" aria-label="Temas frecuentes">
          <button class="chat-topic-btn" type="button" data-chat-topic="cirugias">Cirugías y requisitos</button>
          <button class="chat-topic-btn" type="button" data-chat-topic="uci">UCI y familiares</button>
          <button class="chat-topic-btn" type="button" data-chat-topic="hospitalizacion">Hospitalización</button>
          <button class="chat-topic-btn" type="button" data-chat-topic="contacto">Teléfonos y WhatsApp</button>
        </div>
        <form class="chat-form" id="chat-form-cliente" novalidate>
          <label class="skip-link" for="chat-input-texto">Escribe tu consulta</label>
          <input
            class="chat-input"
            id="chat-input-texto"
            type="text"
            placeholder="Escribe tu pregunta aquí..."
            autocomplete="off"
          >
          <button class="chat-send-btn" type="submit">Enviar</button>
        </form>
        <div class="chat-footer-note" id="chat-whatsapp-footer"></div>
      </div>
      <button
        class="chat-toggle-btn"
        type="button"
        data-chat-toggle
        aria-expanded="false"
        aria-controls="panel-chat-orientacion"
      >
        <svg class="chat-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
        </svg>
        <span>Chat de orientación</span>
      </button>
    `;

    document.body.appendChild(contenedor);

    const panel = contenedor.querySelector('#panel-chat-orientacion');
    const toggleBtn = contenedor.querySelector('[data-chat-toggle]');
    const closeBtn = contenedor.querySelector('[data-chat-close]');
    const messagesBox = contenedor.querySelector('#chat-mensajes');
    const chatForm = contenedor.querySelector('#chat-form-cliente');
    const chatInput = contenedor.querySelector('#chat-input-texto');
    const footerNote = contenedor.querySelector('#chat-whatsapp-footer');

    const actualizarPieWhatsApp = (ultimoMensajeUsuario = '') => {
      if (WHATSAPP_CONFIRMADO) {
        const texto = ultimoMensajeUsuario || 'Hola, deseo realizar una consulta a la Clínica Quirúrgica Novo Group.';
        const url = `https://wa.me/${WHATSAPP_CONFIRMADO}?text=${encodeURIComponent(texto)}`;
        footerNote.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer">Continuar conversación por WhatsApp &rarr;</a>`;
      } else {
        footerNote.innerHTML =
          'WhatsApp directo: <span class="placeholder-marker">[Confirmar WhatsApp]</span> · <a href="contacto.html">Ir al formulario</a>';
      }
    };

    actualizarPieWhatsApp();

    const agregarBurbuja = (texto, tipo) => {
      const div = document.createElement('div');
      div.className = `chat-bubble ${tipo === 'user' ? 'chat-bubble-user' : 'chat-bubble-bot'}`;
      div.textContent = texto;
      messagesBox.appendChild(div);
      messagesBox.scrollTop = messagesBox.scrollHeight;
    };

    const responderSegunTexto = (textoUsuario) => {
      const normalizado = textoUsuario.toLowerCase();
      if (normalizado.includes('cirug') || normalizado.includes('operac') || normalizado.includes('ayuno')) {
        return respuestasOrientativas.cirugias;
      }
      if (normalizado.includes('uci') || normalizado.includes('intensiv')) {
        return respuestasOrientativas.uci;
      }
      if (normalizado.includes('hospital') || normalizado.includes('visita') || normalizado.includes('alta')) {
        return respuestasOrientativas.hospitalizacion;
      }
      return 'Gracias por escribirnos. Para darte una respuesta personalizada sin comprometer datos médicos en este chat automático, completa el formulario en la página de Contacto o comunícate por WhatsApp en cuanto el número oficial esté confirmado.';
    };

    const abrirCerrarChat = (abrir) => {
      panel.hidden = !abrir;
      toggleBtn.setAttribute('aria-expanded', String(abrir));
      if (abrir) {
        chatInput.focus();
      } else {
        toggleBtn.focus();
      }
    };

    toggleBtn.addEventListener('click', () => {
      const abierto = toggleBtn.getAttribute('aria-expanded') === 'true';
      abrirCerrarChat(!abierto);
    });

    closeBtn.addEventListener('click', () => {
      abrirCerrarChat(false);
    });

    document.querySelectorAll('[data-open-chat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        abrirCerrarChat(true);
      });
    });

    contenedor.querySelectorAll('[data-chat-topic]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const clave = btn.getAttribute('data-chat-topic');
        const pregunta = btn.textContent.trim();
        agregarBurbuja(pregunta, 'user');
        agregarBurbuja(respuestasOrientativas[clave] || respuestasOrientativas.contacto, 'bot');
        actualizarPieWhatsApp(pregunta);
      });
    });

    chatForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const texto = chatInput.value.trim();
      if (!texto) return;
      agregarBurbuja(texto, 'user');
      chatInput.value = '';
      const respuesta = responderSegunTexto(texto);
      agregarBurbuja(respuesta, 'bot');
      actualizarPieWhatsApp(texto);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        abrirCerrarChat(false);
      }
    });
  };

  crearWidgetChat();

  // 4. Registro del Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./js/sw.js').catch(() => {
        // El registro puede fallar si se abre con file:// en vez de http://
      });
    });
  }
});
