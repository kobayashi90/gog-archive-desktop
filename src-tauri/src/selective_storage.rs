use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::Context;
use librqbit::storage::{BoxStorageFactory, StorageFactory, StorageFactoryExt, TorrentStorage};
use librqbit::{ManagedTorrentShared, TorrentMetadata};

#[cfg(unix)]
use std::os::unix::fs::FileExt;
#[cfg(windows)]
use std::os::windows::fs::FileExt;

struct StorageConfig {
    only_set: HashSet<usize>,
    output_folder: PathBuf,
}

#[derive(Clone)]
pub struct SelectiveStorageFactory {
    config: Arc<Mutex<StorageConfig>>,
}

impl SelectiveStorageFactory {
    pub fn new(output_folder: PathBuf, selected_files: Option<Vec<usize>>) -> Self {
        let only_set: HashSet<usize> = selected_files.into_iter().flatten().collect();
        Self {
            config: Arc::new(Mutex::new(StorageConfig { only_set, output_folder })),
        }
    }
}

impl StorageFactory for SelectiveStorageFactory {
    type Storage = SelectiveStorage;

    fn create(
        &self,
        _shared: &ManagedTorrentShared,
        metadata: &TorrentMetadata,
    ) -> anyhow::Result<Self::Storage> {
        let config = self.config.lock().unwrap();
        let file_count = metadata.file_infos.len();
        Ok(SelectiveStorage {
            output_folder: config.output_folder.clone(),
            only_set: config.only_set.clone(),
            file_count,
            files: Mutex::new((0..file_count).map(|_| None).collect()),
        })
    }

    fn clone_box(&self) -> BoxStorageFactory {
        self.clone().boxed()
    }
}

pub struct SelectiveStorage {
    output_folder: PathBuf,
    only_set: HashSet<usize>,
    file_count: usize,
    files: Mutex<Vec<Option<File>>>,
}

impl TorrentStorage for SelectiveStorage {
    fn init(
        &mut self,
        _shared: &ManagedTorrentShared,
        metadata: &TorrentMetadata,
    ) -> anyhow::Result<()> {
        let has_filter = !self.only_set.is_empty();
        for (i, fi) in metadata.file_infos.iter().enumerate() {
            if fi.attrs.padding {
                continue;
            }
            if has_filter && !self.only_set.contains(&i) {
                continue;
            }
            let path = self.output_folder.join(&fi.relative_filename);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let f = OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(&path)
                .with_context(|| format!("error opening {path:?}"))?;
            self.files.get_mut().unwrap()[i] = Some(f);
        }
        Ok(())
    }

    fn pread_exact(&self, file_id: usize, offset: u64, buf: &mut [u8]) -> anyhow::Result<()> {
        let files = self.files.lock().unwrap();
        if let Some(Some(file)) = files.get(file_id) {
            #[cfg(unix)]
            {
                file.read_exact_at(buf, offset)?;
            }
            #[cfg(windows)]
            {
                file.seek_read(buf, offset)?;
            }
            #[cfg(not(any(unix, windows)))]
            {
                anyhow::bail!("pread_exact not supported on this platform");
            }
        } else {
            buf.fill(0);
        }
        Ok(())
    }

    fn pwrite_all(&self, file_id: usize, offset: u64, buf: &[u8]) -> anyhow::Result<()> {
        let files = self.files.lock().unwrap();
        if let Some(Some(file)) = files.get(file_id) {
            #[cfg(unix)]
            {
                file.write_all_at(buf, offset)?;
            }
            #[cfg(windows)]
            {
                let mut remaining = buf;
                let mut off = offset;
                while !remaining.is_empty() {
                    let written = file.seek_write(remaining, off)?;
                    remaining = &remaining[written..];
                    off += written as u64;
                }
            }
            #[cfg(not(any(unix, windows)))]
            {
                anyhow::bail!("pwrite_all not supported on this platform");
            }
        }
        Ok(())
    }

    fn remove_file(&self, file_id: usize, filename: &Path) -> anyhow::Result<()> {
        {
            let mut files = self.files.lock().unwrap();
            if let Some(slot) = files.get_mut(file_id) {
                *slot = None;
            }
        }
        let path = self.output_folder.join(filename);
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        Ok(())
    }

    fn ensure_file_length(&self, file_id: usize, length: u64) -> anyhow::Result<()> {
        let files = self.files.lock().unwrap();
        if let Some(Some(file)) = files.get(file_id) {
            file.set_len(length)?;
        }
        Ok(())
    }

    fn take(&self) -> anyhow::Result<Box<dyn TorrentStorage>> {
        let old = std::mem::take(&mut *self.files.lock().unwrap());
        Ok(Box::new(SelectiveStorage {
            output_folder: self.output_folder.clone(),
            only_set: self.only_set.clone(),
            file_count: self.file_count,
            files: Mutex::new(old),
        }))
    }

    fn remove_directory_if_empty(&self, path: &Path) -> anyhow::Result<()> {
        let path = self.output_folder.join(path);
        if path.is_dir() && path.read_dir().map(|mut i| i.next().is_none()).unwrap_or(false) {
            std::fs::remove_dir(&path)?;
        }
        Ok(())
    }
}
