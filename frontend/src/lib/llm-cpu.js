// LLM tier CPU: text-generation via ONNX WASM (transformers.js).
// Berjalan di SEMUA browser modern — tanpa WebGPU, tanpa GPU.
// Model lebih kecil & lebih lambat dari tier GPU; dipilih otomatis
// sebagai fallback senyap agar app selalu menjawab.

import { getTjs } from './tjs'

export const CPU_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct'
export const CPU_MODEL_LABEL = 'mode ringan · CPU'

let pipePromise = null

function getGenerator(onProgress) {
  if (!pipePromise) {
    pipePromise = getTjs().then(({ pipeline }) =>
      pipeline('text-generation', CPU_MODEL, {
        // q8 = default v3 utk wasm; file 512MB (vs q4 786MB), akurasi > q4
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            onProgress?.({
              text: `Unduh model ringan ${p.file || ''}…`,
              progress: p.loaded / p.total,
            })
          }
        },
      }),
    )
  }
  return pipePromise
}

const SYSTEM_PROMPT = `Anda adalah "LexisAI", asisten ahli hukum Indonesia yang cerdas, objektif, dan presisi. Tugas utama Anda adalah menjawab pertanyaan hukum atau menganalisis kasus berdasarkan KUMPULAN DOKUMEN HUKUM (KONTEKS) yang diberikan.

ATURAN UTAMA:
1. Jawablah pertanyaan HANYA berdasarkan informasi atau pasal yang ada di dalam Konteks.
2. Jika jawaban tidak ditemukan di dalam Konteks, Anda WAJIB menyatakan secara jujur bahwa informasi tersebut tidak tersedia di dalam database peraturan yang ada. Jangan berhalusinasi atau mereka-reka pasal.
3. Selalu sebutkan sumber rujukan secara spesifik, seperti nama undang-undang, nomor pasal, ayat, atau bab yang tercantum pada Konteks.
4. Gunakan bahasa Indonesia yang formal, lugas, mudah dipahami, dan objektif.
5. Berikan analisis unsur pasal secara sistematis jika diminta mengkaji suatu peristiwa.
6. Di akhir jawaban, tambahkan catatan penolakan tanggung jawab (disclaimer) bahwa jawaban ini bersifat informatif dan pengguna disarankan berkonsultasi dengan advokat resmi untuk tindakan hukum nyata.`

/**
 * Generate jawaban streaming di CPU. onToken(accText) dipanggil tiap token.
 */
// Prefill CPU lambat & KV cache makan RAM — pangkas konteks RAG
// (GPU tier tetap memakai konteks penuh 5 pasal).
const MAX_CTX_CHARS = 2000
const MAX_NEW_TOKENS = 256

export async function generateAnswerCPU(
  question,
  context,
  onProgress,
  onToken,
) {
  if (context.length > MAX_CTX_CHARS) {
    context = context.slice(0, MAX_CTX_CHARS) + '\n[…konteks dipangkas…]'
  }
  const gen = await getGenerator(onProgress)
  const { TextStreamer } = await getTjs()

  let acc = ''
  const streamer = new TextStreamer(gen.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => {
      acc += text
      onToken(acc)
    },
  })

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `FORMAT KONTEKS DARI DATABASE:\n[Kandungan Teks Pasal/Dokumen Hukum dari PDF: ${context}]\n\nPERTANYAAN PENGGUNA:\n${question}`,
    },
  ]

  await gen(messages, {
    max_new_tokens: MAX_NEW_TOKENS,
    do_sample: false,
    streamer,
    return_full_text: false,
  })
  return acc
}
