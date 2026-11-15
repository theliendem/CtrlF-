//! all-MiniLM-L6-v2 through Candle. Same code runs natively (src/main.rs) and as WASM (bench.html).
//! Output: one L2-normalized 384-d vector per text (mean pooling over the attention mask),
//! matching sentence-transformers.

use anyhow::{anyhow, Result};
use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config};
use tokenizers::{PaddingParams, Tokenizer, TruncationParams};

pub const DIM: usize = 384;
pub const MAX_TOKENS: usize = 128;

pub struct Embedder {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
}

impl Embedder {
    pub fn new(weights: Vec<u8>, tokenizer_json: &[u8], config_json: &[u8]) -> Result<Self> {
        let device = Device::Cpu;
        let config: Config = serde_json::from_slice(config_json)?;
        let vb = VarBuilder::from_buffered_safetensors(weights, DType::F32, &device)?;
        let model = BertModel::load(vb, &config)?;
        let mut tokenizer = Tokenizer::from_bytes(tokenizer_json).map_err(|e| anyhow!(e))?;
        tokenizer.with_padding(Some(PaddingParams::default())); // pad to longest in batch
        tokenizer
            .with_truncation(Some(TruncationParams { max_length: MAX_TOKENS, ..Default::default() }))
            .map_err(|e| anyhow!(e))?;
        Ok(Self { model, tokenizer, device })
    }

    /// Embeds one batch. Returns texts.len() * DIM floats, row-major.
    pub fn embed(&self, texts: &[String]) -> Result<Vec<f32>> {
        let enc = self.tokenizer.encode_batch(texts.to_vec(), true).map_err(|e| anyhow!(e))?;
        let rows = |f: &dyn Fn(&tokenizers::Encoding) -> &[u32]| -> Result<Tensor> {
            let v: Vec<Tensor> = enc
                .iter()
                .map(|e| Tensor::new(f(e), &self.device))
                .collect::<candle_core::Result<_>>()?;
            Ok(Tensor::stack(&v, 0)?)
        };
        let ids = rows(&|e| e.get_ids())?;
        let types = rows(&|e| e.get_type_ids())?;
        let mask = rows(&|e| e.get_attention_mask())?;

        let hidden = self.model.forward(&ids, &types, Some(&mask))?; // [b, t, 384]
        let m = mask.to_dtype(DType::F32)?.unsqueeze(2)?; // [b, t, 1]
        let summed = hidden.broadcast_mul(&m)?.sum(1)?; // [b, 384]
        let counts = m.sum(1)?; // [b, 1]
        let mean = summed.broadcast_div(&counts)?;
        let norm = mean.sqr()?.sum_keepdim(1)?.sqrt()?;
        let out = mean.broadcast_div(&norm)?;
        Ok(out.flatten_all()?.to_vec1::<f32>()?)
    }

    pub fn token_count(&self, texts: &[String]) -> Result<usize> {
        let enc = self.tokenizer.encode_batch(texts.to_vec(), true).map_err(|e| anyhow!(e))?;
        Ok(enc.iter().map(|e| e.get_attention_mask().iter().sum::<u32>() as usize).sum())
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub struct WasmEmbedder(super::Embedder);

    #[wasm_bindgen]
    impl WasmEmbedder {
        #[wasm_bindgen(constructor)]
        pub fn new(weights: Vec<u8>, tokenizer: Vec<u8>, config: Vec<u8>) -> Result<WasmEmbedder, JsError> {
            console_error_panic_hook::set_once();
            super::Embedder::new(weights, &tokenizer, &config)
                .map(WasmEmbedder)
                .map_err(|e| JsError::new(&e.to_string()))
        }

        /// Returns a flat Float32Array of texts.length * 384.
        pub fn embed(&self, texts: Vec<String>) -> Result<Vec<f32>, JsError> {
            self.0.embed(&texts).map_err(|e| JsError::new(&e.to_string()))
        }

        pub fn token_count(&self, texts: Vec<String>) -> Result<usize, JsError> {
            self.0.token_count(&texts).map_err(|e| JsError::new(&e.to_string()))
        }
    }
}
