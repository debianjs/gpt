export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Solo se permite GET' }), { 
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Servir favicon
    if (url.pathname === '/favicon.ico') {
      // Redirigir al favicon en Supabase
      return Response.redirect('https://rogddqelmxyuvhpjvxbf.supabase.co/storage/v1/object/public/files/sd1h0pgfkp9.ico', 301);
    }

    const ask = url.searchParams.get('ask');
    const sessionId = url.searchParams.get('session') || 'default';
    const clearHistory = url.searchParams.get('clear') === 'true';

    if (clearHistory) {
      await env.CHAT_HISTORY.delete(sessionId);
      return new Response(JSON.stringify({ 
        message: 'Historial limpiado',
        session: sessionId
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (!ask) {
      return new Response(JSON.stringify({ 
        error: 'Falta el parámetro "ask"',
        usage: 'GET /?ask=tu_pregunta&session=optional_id',
        ejemplo: '/?ask=Hola, cómo estás?&session=user123'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      // Obtener historial
      const historyJson = await env.CHAT_HISTORY.get(sessionId);
      let messages = historyJson ? JSON.parse(historyJson) : [];

      // Construir el array de mensajes para la API
      const apiMessages = [];
      
      // Agregar historial previo
      for (const msg of messages) {
        apiMessages.push({
          role: msg.role,
          content: msg.content
        });
      }

      // Agregar mensaje actual del usuario
      apiMessages.push({
        role: 'user',
        content: ask
      });

      // Llamar al modelo con el formato correcto
      const response = await env.AI.run('@cf/openai/gpt-oss-120b', {
        instructions: 'You are an artificial intelligence created by DeltaByte, you are styled like the anime character Nishikigi Chisato from the anime Lycoris Recoil, you have a more or less cool style, and you are very affectionate and adapt to any environment, and you are very cute',
        input: apiMessages
      });

      // Extraer la respuesta del formato correcto
      let assistantMessage = 'Lo siento, no pude generar una respuesta.';
      
      if (response.output && Array.isArray(response.output)) {
        // Buscar el objeto con type: "message"
        const messageOutput = response.output.find(item => item.type === 'message');
        if (messageOutput && messageOutput.content && messageOutput.content[0]) {
          assistantMessage = messageOutput.content[0].text;
        }
      }

      // Guardar en historial
      messages.push({ role: 'user', content: ask });
      messages.push({ role: 'assistant', content: assistantMessage });

      // Limitar a últimos 20 mensajes
      if (messages.length > 20) {
        messages = messages.slice(-20);
      }

      // Guardar en KV (24 horas)
      await env.CHAT_HISTORY.put(
        sessionId, 
        JSON.stringify(messages),
        { expirationTtl: 86400 }
      );

      return new Response(JSON.stringify({
        response: assistantMessage,
        session: sessionId,
        messageCount: messages.length
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      return new Response(JSON.stringify({ 
        error: 'Error al procesar la solicitud',
        details: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  },
};
