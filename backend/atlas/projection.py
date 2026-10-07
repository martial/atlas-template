import numpy as np
from sklearn.decomposition import PCA
from sklearn.neighbors import NearestNeighbors


def project(vectors):
    """Stable tiny-set fallback; UMAP for useful-size collections. Never fabricate random layouts."""
    matrix = np.asarray(vectors, dtype=np.float32)
    count = len(matrix)
    if count == 0:
        return [], [], "empty"
    if count < 6 or np.unique(matrix, axis=0).shape[0] < 6:
        coords = np.zeros((count, 3), dtype=np.float32)
        if count > 1 and np.ptp(matrix, axis=0).max() > 1e-8:
            n = min(3, count - 1, matrix.shape[1])
            coords[:, :n] = PCA(n_components=n).fit_transform(matrix)
        method = "PCA (small collection)"
    else:
        from umap import UMAP
        coords = UMAP(n_components=3, n_neighbors=min(15, count - 1), metric="cosine",
                      min_dist=.18, random_state=42, n_jobs=1, init="random").fit_transform(matrix)
        method = "UMAP"
    # Use the same 3D projection for both views; the 2D view shows its x/y plane.
    for axis in range(3):
        values = coords[:, axis]
        extent = float(np.ptp(values))
        coords[:, axis] = (values - values.min()) / extent * 2 - 1 if extent > 1e-6 else 0
    neighbors = NearestNeighbors(n_neighbors=min(5, count), metric="cosine").fit(matrix)
    distances, indices = neighbors.kneighbors(matrix)
    edges = [[i, int(j)] for i, row in enumerate(indices) for k, j in enumerate(row)
             if j > i and distances[i, k] < .85]
    return coords.tolist(), edges, method
