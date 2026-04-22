CREATE TYPE "GraphNodeKind" AS ENUM ('space', 'folder', 'room_ref');
CREATE TYPE "GraphTargetType" AS ENUM ('none', 'room');
CREATE TYPE "GraphEdgeType" AS ENUM ('child');

CREATE TABLE graph_nodes (
  id serial PRIMARY KEY,
  kind "GraphNodeKind" NOT NULL,
  title varchar(160) NOT NULL,
  path_segment varchar(80),
  target_type "GraphTargetType" NOT NULL DEFAULT 'none',
  target_id integer,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  archived_at timestamptz(3)
);

CREATE TABLE graph_edges (
  id serial PRIMARY KEY,
  parent_node_id integer NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  child_node_id integer NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  edge_type "GraphEdgeType" NOT NULL DEFAULT 'child',
  sort_order integer NOT NULL DEFAULT 0,
  meta_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX graph_edges_parent_child_unique
  ON graph_edges(parent_node_id, child_node_id);

CREATE UNIQUE INDEX graph_edges_child_unique
  ON graph_edges(child_node_id);

CREATE INDEX graph_edges_parent_sort_idx
  ON graph_edges(parent_node_id, sort_order);

CREATE INDEX graph_nodes_kind_idx
  ON graph_nodes(kind);

CREATE INDEX graph_nodes_target_idx
  ON graph_nodes(target_type, target_id);

CREATE INDEX graph_nodes_archived_idx
  ON graph_nodes(archived_at);
