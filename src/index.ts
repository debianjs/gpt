export interface Env {
  AI: any;
  CHAT_HISTORY: KVNamespace;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      // Obtener historial de conversación
      const historyJson = await env.CHAT_HISTORY.get(sessionId);
      let messages: Message[] = historyJson ? JSON.parse(historyJson) : [];

      // Sistema prompt para formatear código
      if (messages.length === 0) {
        messages.push({
          role: 'system',
          content: 'Eres un asistente útil. Cuando generes código, usa bloques de código markdown con el lenguaje especificado. Por ejemplo: ```javascript o ```python'
        });
      }

      // Agregar mensaje del usuario
      messages.push({
        role: 'user',
        content: ask
      });

      // Llamar al modelo de AI
      const response = await env.AI.run('@cf/openai/gpt-oss-120b', {
        messages: messages
      });

      const assistantMessage = response.response || 'Lo siento, no pude generar una respuesta.';

      // Guardar respuesta en historial
      messages.push({
        role: 'assistant',
        content: assistantMessage
      });

      // Limitar historial a últimos 20 mensajes (sin contar system)
      if (messages.length > 21) {
        messages = [messages[0], ...messages.slice(-20)];
      }

      // Guardar en KV (expira en 24 horas)
      await env.CHAT_HISTORY.put(
        sessionId, 
        JSON.stringify(messages),
        { expirationTtl: 86400 }
      );

      return new Response(JSON.stringify({
        response: assistantMessage,
        session: sessionId,
        messageCount: messages.length - 1
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error: any) {
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
