#!/usr/bin/env python3
"""Ultimate prune exporter

读取跟前端相同结构的 Excel，执行究极剔品，输出与“导出吞并CSV”一致的结果。

用法：
    python ultimate_prune_export.py input.xlsx [-o output.csv] [--sheet SHEETNAME]

依赖：pandas、openpyxl
"""

from __future__ import annotations

import argparse
import math
from collections import defaultdict, deque, OrderedDict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

import numbers
import pandas as pd

CODE_HEADERS = {"ID", "Id", "id", "编码", "编号", "商品编码", "物料编码", "sku", "SKU", "商品ID", "商品编号"}
NAME_HEADERS = {"名称", "商品名称", "物料名称", "品名", "标题", "name", "Name"}
REL_HEADERS = {"同品", "同品ID", "同品关系", "关联", "关联ID", "相似", "相似ID", "peers", "neighbors", "links"}


def normalize(value) -> str:
    if value is None:
        return ""
    if isinstance(value, numbers.Integral):
        return str(int(value))
    if isinstance(value, numbers.Real):
        if math.isnan(value) or math.isinf(value):
            return ""
        if value.is_integer():
            return str(int(value))
        return ("%f" % value).rstrip("0").rstrip(".")
    text = str(value)
    return text.strip()


def infer_header_indexes(rows: Sequence[Sequence[str]]) -> Tuple[int, int, int]:
    code_idx = name_idx = rel_idx = -1
    for row in rows[:5]:
        for idx, cell in enumerate(row):
            val = normalize(cell)
            if not val:
                continue
            if code_idx == -1 and val in CODE_HEADERS:
                code_idx = idx
            if name_idx == -1 and val in NAME_HEADERS:
                name_idx = idx
            if rel_idx == -1 and val in REL_HEADERS:
                rel_idx = idx
        if code_idx != -1 and rel_idx != -1:
            break
    if code_idx == -1 and rows:
        code_idx = 0
    if name_idx == -1 and rows and len(rows[0]) >= 2:
        name_idx = 1
    if rel_idx == -1 and rows and len(rows[0]) >= 3:
        rel_idx = 2
    if code_idx == -1 or rel_idx == -1:
        raise ValueError("无法定位必要的列（需要编码列与同品关系列）")
    return code_idx, name_idx, rel_idx


def build_graph(rows: Sequence[Sequence[str]], code_idx: int, name_idx: int, rel_idx: int) -> Tuple[Dict[str, OrderedDict[str, None]], Dict[str, str]]:
    adjacency: Dict[str, OrderedDict[str, None]] = {}
    names: Dict[str, str] = {}
    nodes: Set[str] = set()

    for row in rows[1:]:
        code = normalize(row[code_idx]) if code_idx < len(row) else ""
        if not code:
            continue
        nodes.add(code)
        if name_idx != -1 and name_idx < len(row):
            name = normalize(row[name_idx])
            if name and code not in names:
                names[code] = name
        rel_raw = normalize(row[rel_idx]) if rel_idx < len(row) else ""
        if not rel_raw:
            adjacency.setdefault(code, OrderedDict())
            continue
        rel_clean = rel_raw.replace("；", ",").replace(";", ",")
        peers = [item.strip() for item in rel_clean.split(',') if item.strip()]
        adjacency.setdefault(code, OrderedDict())
        for peer in peers:
            nodes.add(peer)
            adjacency.setdefault(peer, OrderedDict())
            if peer not in adjacency[code]:
                adjacency[code][peer] = None
            if code not in adjacency[peer]:
                adjacency[peer][code] = None
    for node in nodes:
        adjacency.setdefault(node, OrderedDict())
    return adjacency, names


def find_components(adjacency: Dict[str, OrderedDict[str, None]]) -> List[Set[str]]:
    visited: Set[str] = set()
    components: List[Set[str]] = []
    for node in adjacency:
        if node in visited:
            continue
        comp = set()
        queue = deque([node])
        visited.add(node)
        while queue:
            cur = queue.popleft()
            comp.add(cur)
            for nbr in adjacency[cur].keys():
                if nbr not in visited:
                    visited.add(nbr)
                    queue.append(nbr)
        components.append(comp)
    components.sort(key=lambda c: (-len(c), sorted(c)[0] if c else ""))
    return components


def is_clique(nodes: Iterable[str], neighbor_sets: Dict[str, Set[str]]) -> bool:
    node_list = list(nodes)
    n = len(node_list)
    if n < 2:
        return True
    for i in range(n):
        a = node_list[i]
        neigh = neighbor_sets.get(a, set())
        for j in range(i + 1, n):
            if node_list[j] not in neigh:
                return False
    return True


def pick_merger(node: str, neighbors: Sequence[str], neighbor_sets: Dict[str, Set[str]], preferred: Set[str]) -> Optional[str]:
    best = None
    best_pref = -1
    best_deg = math.inf
    best_mutual = -1
    neighbor_set = set(neighbors)
    for candidate in neighbors:
        cand_neighbors = neighbor_sets.get(candidate, set())
        mutual = len(cand_neighbors & neighbor_set)
        degree = len(cand_neighbors)
        pref_flag = 1 if candidate in preferred else 0
        if (
            pref_flag > best_pref or
            (pref_flag == best_pref and degree < best_deg) or
            (pref_flag == best_pref and degree == best_deg and mutual > best_mutual) or
            (pref_flag == best_pref and degree == best_deg and mutual == best_mutual and (best is None or candidate < best))
        ):
            best = candidate
            best_pref = pref_flag
            best_deg = degree
            best_mutual = mutual
    return best


def prune_component(component: Set[str], base_adj: Dict[str, OrderedDict[str, None]], *, ultimate: bool) -> Tuple[Set[str], List[Tuple[str, Optional[str]]]]:
    current_nodes = set(component)
    sub_adj: Dict[str, OrderedDict[str, None]] = {
        node: OrderedDict((nbr, None) for nbr in base_adj[node].keys() if nbr in component)
        for node in component
    }
    preferred: Set[str] = set()
    records: List[Tuple[str, Optional[str]]] = []

    while True:
        neighbor_lists = {node: [nbr for nbr in sub_adj[node].keys() if nbr in current_nodes] for node in current_nodes}
        neighbor_sets = {node: set(lst) for node, lst in neighbor_lists.items()}
        order = sorted(current_nodes, key=lambda n: (-len(neighbor_lists[n]), n))
        removed = False
        for node in order:
            if node in preferred:
                continue
            neighbors = neighbor_lists[node]
            if not neighbors:
                continue
            clique = is_clique(neighbors, neighbor_sets)
            if not clique or (ultimate and len(neighbors) > 0):
                merger = pick_merger(node, neighbors, neighbor_sets, preferred)
                if merger:
                    preferred.add(merger)
                for nbr in neighbors:
                    sub_adj[nbr].pop(node, None)
                current_nodes.remove(node)
                sub_adj.pop(node, None)
                records.append((node, merger))
                removed = True
                break
        if not removed:
            break
    return current_nodes, records


def ultimate_prune(adjacency: Dict[str, OrderedDict[str, None]]) -> Tuple[Set[str], Dict[str, Set[str]]]:
    survivors: Set[str] = set()
    final_merges: Dict[str, Set[str]] = defaultdict(set)
    victim_parent: Dict[str, str] = {}

    for comp in find_components(adjacency):
        remaining, records = prune_component(comp, adjacency, ultimate=True)
        survivors.update(remaining)
        for victim, merger in records:
            if merger:
                victim_parent[victim] = merger

    def resolve_final(merger: str) -> Optional[str]:
        current = merger
        visited: Set[str] = set()
        while current not in survivors:
            if current not in victim_parent:
                return None
            if current in visited:
                return None
            visited.add(current)
            current = victim_parent[current]
        return current

    for victim, merger in victim_parent.items():
        final = resolve_final(merger)
        if final and final != victim:
            final_merges[final].add(victim)

    return survivors, final_merges


def export_csv(path: Path, survivors: Set[str], merges: Dict[str, Set[str]], names: Dict[str, str]):
    rows: List[Tuple[str, str, str, str]] = []
    all_mergers = set(survivors) | set(merges.keys())
    for merger in sorted(all_mergers):
        merger_name = names.get(merger, "")
        victims = sorted(merges.get(merger, set()))
        if victims:
            for victim in victims:
                rows.append((merger, merger_name, victim, names.get(victim, "")))
        else:
            rows.append((merger, merger_name, "", ""))

    rows.sort(key=lambda r: (r[0], r[2]))

    header = ["序号", "吞并者ID", "吞并者名称", "被吞者ID", "被吞者名称"]
    output = [header]
    seq = 0
    prev_merger = None
    for merger_id, merger_name, victim_id, victim_name in rows:
        if merger_id != prev_merger:
            seq += 1
            prev_merger = merger_id
        output.append([seq, merger_id, merger_name, victim_id, victim_name])

    with path.open('w', encoding='utf-8-sig', newline='') as fh:
        for line in output:
            escaped = []
            for col in line:
                text = str(col).replace('"', '""')
                escaped.append(f'"{text}"')
            fh.write(','.join(escaped) + '\r\n')


def load_rows(excel_path: Path, sheet_name: Optional[str]) -> List[List[str]]:
    sheet_arg = sheet_name if sheet_name is not None else 0
    df = pd.read_excel(excel_path, sheet_name=sheet_arg, header=None, dtype=object)
    if isinstance(df, dict):
        if sheet_name and sheet_name in df:
            df = df[sheet_name]
        else:
            df = next(iter(df.values()))
    df = df.replace({pd.NA: '', None: ''})
    return df.values.tolist()


def main():
    parser = argparse.ArgumentParser(description='执行究极剔品并导出吞并 CSV')
    parser.add_argument('input', help='输入 Excel 文件路径')
    parser.add_argument('-o', '--output', help='输出 CSV 文件路径（默认与输入同名）')
    parser.add_argument('--sheet', help='指定 Sheet 名称（默认首个 Sheet）')
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.exists():
        raise SystemExit(f'找不到输入文件: {input_path}')

    output_path = Path(args.output).expanduser().resolve() if args.output else input_path.with_suffix('')
    if output_path.suffix.lower() != '.csv':
        output_path = output_path.with_suffix('.csv')

    rows = load_rows(input_path, args.sheet)
    code_idx, name_idx, rel_idx = infer_header_indexes(rows)
    adjacency, names = build_graph(rows, code_idx, name_idx, rel_idx)
    survivors, merges = ultimate_prune(adjacency)
    export_csv(output_path, survivors, merges, names)
    print(f'已生成 {output_path}')


if __name__ == '__main__':
    main()
