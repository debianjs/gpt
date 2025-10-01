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

      // Construir el contexto completo de la conversación
      let conversationContext = '';
      
      if (messages.length > 0) {
        conversationContext = messages.map(msg => {
          if (msg.role === 'user') return `Usuario: ${msg.content}`;
          if (msg.role === 'assistant') return `Asistente: ${msg.content}`;
          return '';
        }).filter(m => m).join('\n\n') + '\n\n';
      }

      // Agregar instrucción para formato de código
      const systemPrompt = 'Cuando generes código, usa bloques de código markdown con el lenguaje especificado (```javascript, ```python, etc.).\n\n';
      
      // Construir el prompt completo con contexto
      const fullPrompt = systemPrompt + conversationContext + `Usuario: ${ask}\n\nAsistente:`;

      // Llamar al modelo de AI con el formato correcto
      const response = await env.AI.run('@cf/openai/gpt-oss-120b', {
        prompt: fullPrompt,
        max_tokens: 1000,
        temperature: 0.7
      });

      const assistantMessage = response.response || 'Lo siento, no pude generar una respuesta.';

      // Guardar en historial
      messages.push({
        role: 'user',
        content: ask
      });

      messages.push({
        role: 'assistant',
        content: assistantMessage
      });

      // Limitar historial a últimos 10 intercambios (20 mensajes)
      if (messages.length > 20) {
        messages = messages.slice(-20);
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
        messageCount: messages.length
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
