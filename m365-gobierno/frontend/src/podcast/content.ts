/**
 * Guion del podcast "El mapa de Business Premium, caja por caja".
 * a = qué es, en lenguaje simple · ej = ejemplo concreto de uso en una empresa.
 */
export interface Explain {
  a: string;
  ej?: string;
}

export const HOSTS = { A: 'Camila', B: 'Martín' } as const;

export const EXPLAIN: Record<string, Explain> = {
  // ---------------- Entra ID P1 ----------------
  mfa: {
    a: 'Es el segundo candado. Además de la contraseña, la persona confirma que es ella con el celular, una llave física o su huella. Es la medida que más ataques detiene: más del 99 por ciento de los robos de cuenta.',
    ej: 'Si alguien consigue la clave de un vendedor con un correo falso, igual no puede entrar, porque la aprobación llega al teléfono del vendedor y no al del atacante.',
  },
  'conditional-access': {
    a: 'Es el portero inteligente de Microsoft 365. Antes de dejar entrar a alguien revisa quién es, desde dónde se conecta, con qué equipo y a qué aplicación quiere entrar, y decide: dejar pasar, pedir MFA o bloquear.',
    ej: 'Por ejemplo: a los administradores siempre se les pide MFA; si alguien entra desde un país donde la empresa no opera, se bloquea; y si el computador no es de la empresa, solo puede usar Outlook en el navegador.',
  },
  passwordless: {
    a: 'Permite entrar sin contraseña: con una passkey en el celular, una llave FIDO2 o Windows Hello. Como no hay contraseña, no hay nada que robar con un correo de phishing.',
    ej: 'La gerente de finanzas entra a su correo mirando la cámara del notebook o tocando una llave USB, sin escribir nada.',
  },
  'temporary-access-pass': {
    a: 'Es un código temporal que entrega el equipo de TI para que una persona nueva, o alguien que perdió su celular, pueda registrar sus métodos de seguridad.',
    ej: 'Llega un colaborador nuevo el lunes: TI le da un código válido por una hora y con él configura Authenticator en su teléfono.',
  },
  'sms-sign-in': {
    a: 'Permite iniciar sesión solo con un código por SMS. Es útil para trabajadores de terreno sin correo, pero como método de seguridad el SMS es débil, porque se puede robar el número de teléfono.',
    ej: 'La recomendación es migrar a Authenticator y luego desactivar el SMS como segundo factor.',
  },
  'third-party-mfa': {
    a: 'Permite usar un proveedor de MFA externo, como Duo u Okta, en lugar del de Microsoft.',
    ej: 'Sirve si la empresa ya pagó otra solución de MFA y quiere mantenerla por un tiempo.',
  },
  'password-protection': {
    a: 'Impide que las personas elijan contraseñas débiles o fáciles de adivinar, como el nombre de la empresa, la ciudad o "Verano2026".',
    ej: 'Si alguien intenta poner "Phoenix2026", el sistema lo rechaza y le pide otra.',
  },
  sspr: {
    a: 'Restablecimiento de contraseña de autoservicio: la persona recupera su clave sola, validando su identidad con el celular, sin llamar a soporte. Si hay Active Directory local, el cambio también se escribe allá.',
    ej: 'Un domingo alguien olvida su clave: entra a aka.ms/sspr, valida con su teléfono y sigue trabajando. Soporte se ahorra el ticket del lunes.',
  },
  'self-service-activity-reports': {
    a: 'Son los informes de cuánta gente registró sus métodos de seguridad y usó el restablecimiento de contraseña.',
    ej: 'Permiten ver, por ejemplo, que el 30 por ciento todavía no tiene MFA registrado y a quién hay que perseguir.',
  },
  'self-service-group-management': {
    a: 'Define qué pueden hacer los usuarios por su cuenta: crear grupos y equipos de Teams, registrar aplicaciones, invitar externos o aceptar permisos de aplicaciones de terceros.',
    ej: 'Evita que un usuario, sin saberlo, le dé a una aplicación maliciosa acceso a todo su correo con un solo clic de "Aceptar".',
  },
  'dynamic-groups': {
    a: 'Son grupos que se arman solos según reglas. En vez de agregar personas a mano, la regla dice quién entra: por ejemplo, todos los del área Ventas, o todos los equipos con Windows.',
    ej: 'Cuando se contrata a alguien en Ventas, entra automáticamente al grupo de Ventas y recibe las políticas de ese grupo.',
  },
  'administrative-units': {
    a: 'Permiten delegar la administración por área o sucursal. Un encargado puede administrar solo a los usuarios de su sucursal, sin tener permisos sobre toda la empresa.',
    ej: 'El encargado de TI de la sucursal Antofagasta puede restablecer claves de su gente, pero no de la casa matriz.',
  },
  'custom-security-attributes': {
    a: 'Son etiquetas propias que se agregan a usuarios y aplicaciones para clasificarlos, por ejemplo por nivel de confidencialidad o centro de costo.',
    ej: 'Se puede marcar a las personas que manejan datos de clientes y usar esa marca en políticas de acceso.',
  },
  'customized-sign-in': {
    a: 'Personaliza la página de inicio de sesión con el logo, los colores y un mensaje de la empresa.',
    ej: 'Si un usuario llega a una página de login sin el logo ni el mensaje habitual, sospecha que es falsa. Es una ayuda contra el phishing.',
  },
  'external-id': {
    a: 'Es la forma de colaborar con personas de otras organizaciones, los invitados, usando su propia cuenta y sin crearles una cuenta interna.',
    ej: 'Un proveedor entra a un equipo de Teams del proyecto con su correo de su empresa, y se le puede exigir MFA igual.',
  },
  'sso-saas': {
    a: 'Inicio de sesión único: con una sola cuenta corporativa se entra a otras aplicaciones de la nube, como Salesforce, Zoom o el sistema de RRHH.',
    ej: 'Cuando alguien deja la empresa, al deshabilitar su cuenta pierde el acceso a todas esas aplicaciones de una vez.',
  },
  'shared-password-rollover': {
    a: 'Permite compartir el acceso a cuentas compartidas, como la de redes sociales, sin revelar la contraseña a cada persona, y rotarla automáticamente.',
    ej: 'El equipo de marketing usa la cuenta de la empresa en una red social sin que nadie conozca la clave.',
  },
  'app-proxy': {
    a: 'Publica aplicaciones web internas, de la oficina, para usarlas desde fuera sin VPN y con el mismo inicio de sesión y MFA de Microsoft.',
    ej: 'El sistema de inventario que vive en un servidor de la bodega se puede abrir desde la casa con la cuenta corporativa.',
  },
  'cloud-app-discovery': {
    a: 'Descubre qué aplicaciones de la nube está usando la gente sin que TI lo sepa, lo que se conoce como "shadow IT".',
    ej: 'Se descubre que varias áreas suben archivos de clientes a un servicio gratuito de transferencia.',
  },
  'advanced-security-reports': {
    a: 'Son informes de inicios de sesión sospechosos: desde lugares extraños, muchos intentos fallidos o credenciales filtradas.',
    ej: 'Alerta cuando una misma cuenta entra desde Santiago y, diez minutos después, desde otro continente.',
  },
  'connect-health': {
    a: 'Monitorea el servidor que sincroniza el Active Directory local con la nube, para saber si la sincronización falla.',
    ej: 'Avisa si las cuentas nuevas creadas en la oficina dejaron de llegar a Microsoft 365.',
  },
  mim: {
    a: 'Microsoft Identity Manager es una herramienta local para sincronizar identidades en escenarios complejos, con varios directorios o sistemas antiguos.',
    ej: 'Es poco común en pymes; se usa cuando hay varios sistemas de usuarios que deben mantenerse alineados.',
  },
  'enterprise-state-roaming': {
    a: 'Sincroniza la configuración de Windows, como el fondo de pantalla y preferencias, entre los equipos corporativos de una misma persona.',
    ej: 'Si a alguien le cambian el notebook, su configuración aparece igual en el nuevo.',
  },
  'internet-access-microsoft': {
    a: 'Protege el tráfico hacia Microsoft 365 a través del servicio de acceso seguro de Microsoft, y permite aplicar reglas sobre desde dónde se conecta la gente.',
    ej: 'Ayuda a evitar que una sesión robada se use desde fuera de la red conocida.',
  },
  'tenant-restrictions': {
    a: 'Impide que, desde los equipos o la red de la empresa, se inicie sesión en cuentas de Microsoft de otras organizaciones.',
    ej: 'Evita que alguien copie archivos a su cuenta personal o a la de otra empresa desde el computador del trabajo.',
  },
  'terms-of-use': {
    a: 'Obliga a aceptar la política de uso aceptable antes de entrar, y deja registro de quién la aceptó y cuándo.',
    ej: 'Útil para demostrar en una auditoría que cada colaborador aceptó las reglas de uso de la información.',
  },
  'verified-id': {
    a: 'Son credenciales digitales verificables, como una credencial de empleado digital, que se pueden validar sin llamar a nadie.',
    ej: 'Sirve para verificar la identidad de una persona contratada a distancia antes de entregarle acceso.',
  },
  sla: {
    a: 'Es el compromiso de Microsoft de que el inicio de sesión estará disponible el 99,99 por ciento del tiempo.',
  },
  'agent-id': {
    a: 'Son identidades para agentes de inteligencia artificial, para que un agente tenga su propia cuenta con permisos controlados y auditados, como cualquier persona.',
    ej: 'Un agente que responde consultas de clientes tiene su propia identidad y solo puede leer la base de conocimiento.',
  },
  'windows-autopilot-ems': {
    a: 'Autopilot prepara los computadores nuevos solos. El equipo sale de la caja, la persona se conecta a internet e inicia sesión con su cuenta, y se instala todo lo corporativo.',
    ej: 'TI ya no tiene que armar cada notebook: el proveedor lo envía directo a la casa del colaborador.',
  },

  // ---------------- Intune ----------------
  'device-management': {
    a: 'Es la administración central de los equipos: computadores y celulares. Permite definir qué es un equipo sano, aplicar configuraciones y borrar los datos si se pierde.',
    ej: 'Si se roban un notebook, TI lo bloquea o borra a distancia y comprueba que el disco estaba cifrado.',
  },
  'application-management': {
    a: 'Protege los datos de la empresa dentro de las aplicaciones del celular, como Outlook y Teams, aunque el teléfono sea personal. Es lo que se conoce como MAM.',
    ej: 'En el celular personal, la persona no puede copiar un correo de la empresa a WhatsApp, y si se va de la empresa se borran solo los datos corporativos, no sus fotos.',
  },
  'endpoint-analytics': {
    a: 'Mide la experiencia real de los equipos: cuánto demoran en encender, qué aplicaciones fallan, cuáles están lentos.',
    ej: 'Ayuda a decidir qué notebooks renovar primero con datos y no por reclamos.',
  },
  'information-protection': {
    a: 'Permite clasificar la información con etiquetas como Público, Interno o Confidencial, y cifrarla para que solo las personas autorizadas puedan abrirla, aunque el archivo salga de la empresa.',
    ej: 'Un Excel de remuneraciones etiquetado como Altamente confidencial no se puede abrir si alguien lo reenvía por error a una persona externa.',
  },

  // ---------------- Windows Pro ----------------
  'application-control': {
    a: 'Solo permite ejecutar programas confiables y bloquea todo lo demás. Es de las medidas más fuertes contra el ransomware.',
    ej: 'Si llega un archivo malicioso por correo y alguien lo abre, simplemente no se ejecuta.',
  },
  applocker: {
    a: 'Es la versión clásica de listas de programas permitidos y bloqueados, por carpeta o por fabricante.',
    ej: 'Se bloquea la ejecución de programas desde la carpeta Descargas.',
  },
  'assigned-access': {
    a: 'Modo quiosco: el equipo solo muestra una aplicación, por ejemplo en una recepción o en un punto de venta.',
  },
  bitlocker: {
    a: 'Cifra todo el disco del computador. Si alguien se roba el notebook, no puede leer los archivos sin la clave, que queda guardada en Entra ID.',
    ej: 'Un notebook olvidado en un taxi deja de ser una filtración de datos personales: es solo la pérdida de un equipo.',
  },
  'bitlocker-to-go': {
    a: 'Es el cifrado de pendrives y discos externos.',
    ej: 'Si se pierde un pendrive con una base de clientes, nadie la puede abrir sin la clave.',
  },
  'defender-antivirus': {
    a: 'Es el antivirus que viene integrado en Windows, administrado de forma central con protección en la nube.',
  },
  'domain-join': {
    a: 'Es la forma tradicional de unir un computador al Active Directory de la oficina.',
    ej: 'Hoy la recomendación es unir los equipos directo a Entra ID, en la nube.',
  },
  'entra-id-join': {
    a: 'Une el computador a la cuenta corporativa en la nube. La persona inicia sesión en Windows con su correo de la empresa y el equipo queda administrado.',
  },
  'edge-business': {
    a: 'Es el navegador corporativo, con perfiles separados de trabajo y personal y protección contra sitios maliciosos.',
  },
  laps: {
    a: 'Cada computador tiene una contraseña de administrador local distinta, que cambia sola cada cierto tiempo y queda guardada de forma segura.',
    ej: 'Si un atacante obtiene la clave de administrador de un equipo, no le sirve para entrar a los demás.',
  },
  'manage-by-mdm': {
    a: 'Significa que Windows se puede administrar por Intune, sin servidores en la oficina.',
  },
  'pad-flows': {
    a: 'Permite automatizar tareas repetitivas del escritorio con Power Automate Desktop, un robot que hace clics por la persona.',
    ej: 'Copiar datos de un sistema antiguo a una planilla todos los días.',
  },
  'unbranded-boot': {
    a: 'Oculta los mensajes de arranque de Windows, útil en pantallas de quiosco o de publicidad.',
  },
  'universal-print': {
    a: 'Impresión desde la nube, sin servidores de impresión en la oficina.',
  },
  'windows-autopatch': {
    a: 'Microsoft se encarga de actualizar Windows, Office, Edge y Teams por etapas, primero en pocos equipos y luego en el resto.',
  },
  'windows-conditional-access': {
    a: 'Permite que el acceso a los datos dependa del estado del computador: si no está cifrado o no tiene el antivirus activo, no entra.',
  },
  'windows-firewall': {
    a: 'Es el cortafuegos del computador, que bloquea conexiones que no fueron solicitadas.',
    ej: 'Protege el notebook cuando se conecta al wifi de un café o de un aeropuerto.',
  },
  'windows-hello': {
    a: 'Inicio de sesión en Windows con PIN, huella o rostro, ligado al chip de seguridad del equipo. Reemplaza la contraseña.',
  },
  'windows-update-business': {
    a: 'Controla cuándo se instalan las actualizaciones de Windows y pone plazos para que ningún equipo quede atrasado.',
    ej: 'Las actualizaciones críticas se instalan en máximo cinco días, fuera del horario laboral.',
  },
  'windows-virtualization': {
    a: 'Son los derechos para usar Windows en escritorios virtuales, por ejemplo Windows 365 o Azure Virtual Desktop.',
  },
  'windows-11-support': {
    a: 'Cada versión de Windows 11 Pro tiene 24 meses de soporte con actualizaciones de seguridad.',
  },

  // ---------------- Defender for Business ----------------
  'next-gen-protection': {
    a: 'Es el antivirus de nueva generación: usa aprendizaje automático y la nube de Microsoft para detectar amenazas nuevas.',
  },
  'block-at-first-sight': {
    a: 'Cuando aparece un archivo nunca visto, se analiza en la nube en segundos antes de dejarlo ejecutar.',
    ej: 'Un ransomware recién creado se bloquea aunque todavía no exista una firma para él.',
  },
  'attack-surface-reduction': {
    a: 'Son reglas que bloquean las técnicas que usan los atacantes: macros de Office que lanzan programas, scripts ocultos o robo de contraseñas de la memoria.',
    ej: 'Una factura falsa en Word intenta abrir PowerShell: la regla lo impide.',
  },
  edr: {
    a: 'Detección y respuesta en los equipos: registra lo que pasa en cada computador, detecta comportamientos de ataque y permite aislar un equipo de la red con un clic.',
    ej: 'Si un notebook está infectado, se aísla de inmediato para que no contagie al resto.',
  },
  'automated-investigations': {
    a: 'Cuando hay una alerta, Defender investiga solo y corrige automáticamente lo que encuentra, sin esperar a un analista.',
  },
  'tamper-protection': {
    a: 'Impide que un malware, o un usuario, desactive el antivirus.',
  },
  'web-content-filtering': {
    a: 'Bloquea categorías de sitios web, como contenido para adultos o sitios de riesgo legal, en los equipos de la empresa.',
  },
  'vulnerability-management': {
    a: 'Inventaría el software de cada equipo y muestra qué vulnerabilidades tiene, priorizadas por riesgo.',
    ej: 'Muestra que 40 equipos tienen una versión de un lector de PDF con una falla grave conocida.',
  },
  'threat-analytics': {
    a: 'Informes de Microsoft sobre amenazas activas en el mundo y si la empresa está expuesta a ellas.',
  },
  'centralized-management': {
    a: 'Toda la seguridad de los equipos se administra desde un solo portal: Microsoft Defender.',
  },
  'cross-platform': {
    a: 'La protección cubre Windows, Mac, iPhone y Android.',
  },
  'mobile-threat-defence': {
    a: 'Protege los celulares contra sitios de phishing y aplicaciones maliciosas.',
  },

  // ---------------- Office 365: seguridad y cumplimiento ----------------
  'exchange-online': {
    a: 'Es el correo corporativo de 50 gigas por persona. Su configuración es clave contra el fraude por correo, que es una de las formas de ataque más comunes.',
  },
  'audit-standard': {
    a: 'La auditoría registra quién hizo qué: quién abrió, descargó, compartió o borró un archivo, quién cambió una configuración. Sin auditoría no se puede investigar un incidente.',
    ej: 'Ante una fuga de información, permite saber quién descargó la base de clientes y cuándo.',
  },
  'alert-policies': {
    a: 'Son alertas automáticas ante actividad sospechosa: reenvíos masivos de correo, descargas masivas, permisos elevados.',
  },
  'activity-reports': {
    a: 'Informes de uso de correo, Teams, SharePoint y OneDrive.',
  },
  dlp: {
    a: 'Prevención de pérdida de datos. Detecta información sensible, como RUT, tarjetas de crédito o datos de salud, en correos, Teams y documentos, y avisa o bloquea cuando se intenta enviar fuera de la empresa.',
    ej: 'Alguien intenta mandar a un correo personal una planilla con 200 RUT de clientes: DLP le avisa, bloquea el envío y deja registro.',
  },
  'information-protection-m365': {
    a: 'Son las etiquetas de confidencialidad dentro de Word, Excel, PowerPoint, Outlook y Teams. La persona elige si un documento es Público, Interno o Confidencial.',
  },
  'message-encryption': {
    a: 'Permite enviar correos cifrados a cualquier persona, incluso fuera de Microsoft 365.',
    ej: 'Se envía una liquidación de sueldo a un correo externo y solo el destinatario puede abrirla.',
  },
  'exchange-online-archiving': {
    a: 'Es el archivo de correo a largo plazo y la retención: guarda la información el tiempo que exige la ley, aunque alguien la borre.',
    ej: 'La documentación tributaria se conserva seis años aunque un usuario vacíe su papelera.',
  },
  'ediscovery-standard': {
    a: 'Permite buscar, conservar y exportar información para requerimientos legales o investigaciones internas.',
  },
  'content-search': {
    a: 'Búsqueda de contenido en todos los buzones, sitios y chats de la empresa.',
  },
  'compliance-manager': {
    a: 'Evalúa el cumplimiento frente a normas, como ISO 27001 o la ley de protección de datos, y propone acciones de mejora con un puntaje.',
  },
  'secure-score': {
    a: 'Es el puntaje de seguridad que calcula Microsoft para el tenant, con la lista de acciones para subirlo. Nuestro Assessment lo usa como una de sus fuentes.',
  },
  'basic-mobility-security': {
    a: 'Es una administración básica de celulares que viene con Office 365. Con Business Premium se reemplaza por Intune, que es mucho más completo.',
  },
  'sharepoint-online': {
    a: 'Es la intranet y el lugar donde viven los documentos de las áreas y proyectos. Lo importante es controlar cómo se comparte hacia fuera.',
    ej: 'Evitar los enlaces "cualquier persona con el vínculo", que permiten abrir un documento sin iniciar sesión.',
  },
  onedrive: {
    a: 'Un terabyte de almacenamiento por persona para sus archivos de trabajo, con las mismas reglas de uso compartido que SharePoint.',
  },
  'teams-essentials': {
    a: 'Teams: reuniones, chat y colaboración. Hereda las reglas de grupos, etiquetas y uso compartido.',
  },
  'loop-workspaces': {
    a: 'Espacios colaborativos con componentes que se actualizan en vivo en Teams y Outlook.',
  },
  'copilot-basic': {
    a: 'Es Copilot Chat con protección de datos empresariales. Importante: Copilot ve lo mismo que ve la persona, por eso los permisos y las etiquetas de confidencialidad son la base para usarlo de forma segura.',
  },
  'm365-apps-business': {
    a: 'Word, Excel, PowerPoint y Outlook de escritorio, para instalar en hasta cinco equipos por persona.',
  },
  'm365-mobile-app': {
    a: 'Las aplicaciones de Office en el celular, que se protegen con las políticas de protección de aplicaciones.',
  },

  // ---------------- Defender for Office 365 ----------------
  'safe-links': {
    a: 'Revisa cada enlace en el momento del clic, en el correo, en Teams y en Office. Si el sitio es malicioso, lo bloquea.',
    ej: 'Un enlace que era inofensivo al llegar el correo y se volvió malicioso horas después, igual se bloquea al hacer clic.',
  },
  'safe-attachments': {
    a: 'Abre los archivos adjuntos en un entorno aislado antes de entregarlos, para ver si hacen algo malicioso.',
    ej: 'Una "factura" en PDF que intenta descargar un virus nunca llega a la bandeja de entrada.',
  },
  'advanced-anti-phishing': {
    a: 'Detecta correos que suplantan a ejecutivos, proveedores o al propio dominio de la empresa, usando la inteligencia de cada buzón.',
    ej: 'Llega un correo "del gerente general" pidiendo una transferencia urgente desde un dominio parecido: se detecta y va a cuarentena.',
  },
  'exchange-online-protection': {
    a: 'Es el filtro base de correo: antispam y antimalware. Aquí también se bloquea el reenvío automático hacia fuera y se firma el correo con DKIM.',
    ej: 'Si roban una cuenta y el atacante configura que todo el correo se reenvíe a su casilla, el reenvío queda bloqueado.',
  },
  'real-time-reports': {
    a: 'Explorador en tiempo real de las amenazas que llegan por correo.',
  },
  fasttrack: {
    a: 'Es la asistencia de Microsoft para desplegar Microsoft 365, disponible para organizaciones de 150 licencias o más.',
  },
};

/** Productividad: se agrupan en un solo bloque con una frase cada una. */
export const PRODUCTIVITY = [
  'bookings',
  'clipchamp',
  'dataverse-teams',
  'forms',
  'lists',
  'places',
  'search',
  'todo',
  'whiteboard',
  'office-web',
  'planner',
  'power-apps',
  'power-automate',
  'project-roadmap',
  'sway',
  'teams-webinars',
  'visio-web',
  'viva-connections',
  'viva-engage',
  'viva-insights',
  'viva-learning',
  'adoption-score',
  'graph-connector',
];
