//! Native reference run: cargo run --release --bin native [batch=32]
//! Not what ships; it shows the ceiling the WASM build is chasing.

use candle_bench::{Embedder, DIM};
use std::time::Instant;

fn main() -> anyhow::Result<()> {
    let batch: usize = std::env::args().nth(1).map(|s| s.parse()).transpose()?.unwrap_or(32);
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/..");
    let read = |p: &str| std::fs::read(format!("{dir}/{p}"));
    let texts: Vec<String> = serde_json::from_slice(&read("data/passages.json")?)?;

    let t0 = Instant::now();
    let e = Embedder::new(read("model/model.safetensors")?, &read("model/tokenizer.json")?, &read("model/config.json")?)?;
    let load = t0.elapsed();

    let t1 = Instant::now();
    let mut vecs = Vec::with_capacity(texts.len() * DIM);
    for c in texts.chunks(batch) {
        vecs.extend(e.embed(c)?);
    }
    let total = t1.elapsed();
    let tokens = e.token_count(&texts)?;

    // Sanity: passages 0 and 1 are adjacent slides, should be more similar than passage 0 vs a textbook line.
    let dot = |a: usize, b: usize| (0..DIM).map(|i| vecs[a * DIM + i] * vecs[b * DIM + i]).sum::<f32>();
    println!(
        "native batch={batch}: load {:.0} ms | {} passages, {} tokens | total {:.0} ms | {:.2} ms/passage | sim(0,1)={:.3} sim(0,400)={:.3}",
        load.as_secs_f64() * 1e3,
        texts.len(),
        tokens,
        total.as_secs_f64() * 1e3,
        total.as_secs_f64() * 1e3 / texts.len() as f64,
        dot(0, 1),
        dot(0, 400)
    );
    Ok(())
}
