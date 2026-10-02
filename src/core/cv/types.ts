export interface Point {
  x: number
  y: number
}

export type Quad = [Point, Point, Point, Point]

export type FilterMode = 'original' | 'grayscale' | 'bw' | 'enhance' | 'magic'

export interface ScanPage {
  id: string
  name: string
  blob: Blob
  previewUrl: string
  width: number
  height: number
  filter: FilterMode
  quad: Quad
  rawBlob: Blob
  rawWidth: number
  rawHeight: number
  createdAt: number
}

export interface EditorView {
  offsetX: number
  offsetY: number
  scale: number
  drawWidth: number
  drawHeight: number
  imageWidth: number
  imageHeight: number
}

export interface ProcessImageOptions {
  blob: Blob
  quad?: Quad
  filter?: FilterMode
  rotate?: number // in degrees: 0, 90, 180, 270
}
