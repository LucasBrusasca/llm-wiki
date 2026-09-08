import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/* ══════════════════════════════════════════════════════════════════════════
   MULTIVERSO — Tesseract 3D con Cubos de Vidrio
   
   Estructura de cubos anidados estilo hipercubo/tesseract.
   Cada cubo = una dimensión/sección con su grafo visible adentro.
   Navegación: orbit + click cubo para enfocar → click para entrar.
   ══════════════════════════════════════════════════════════════════════════ */

const CUBE_COLORS = [
  0x00D4FF, // cyan
  0x2FE0C8, // turquoise
  0x7B68EE, // purple
  0xFF6B9D, // pink
  0xFFB84D, // orange
  0xA78BFA, // lavender
];

export default function MultiverseMap({
  sections,
  onSelectSection,
  onClose,
  currentSection
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const cubesRef = useRef([]);
  const graphNodesRef = useRef({});
  const rafRef = useRef(null);
  
  const [loading, setLoading] = useState(true);
  const [focusedCube, setFocusedCube] = useState(null);
  const [sectionData, setSectionData] = useState({});
  const [hintText, setHintText] = useState('Orbita para explorar · Click en un cubo para enfocar');

  // Cargar datos del grafo de cada sección
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const data = {};
      
      for (const section of sections) {
        try {
          const r = await fetch(`/api/graph?seccion=${encodeURIComponent(section.nombre)}`);
          const json = await r.json();
          const nodes = (json.nodos || []).slice(0, 100).map(n => ({
            id: n.id,
            x: (n.x3d ?? Math.random() - 0.5) * 0.8,
            y: (n.y3d ?? Math.random() - 0.5) * 0.8,
            z: (n.z3d ?? Math.random() - 0.5) * 0.8,
          }));
          const links = (json.relaciones || []).slice(0, 150);
          data[section.nombre] = { nodes, links, count: json.nodos?.length || 0 };
        } catch {
          data[section.nombre] = { nodes: [], links: [], count: section.count || 0 };
        }
      }
      
      setSectionData(data);
      setLoading(false);
    };
    
    loadData();
  }, [sections]);

  // Crear escena Three.js
  useEffect(() => {
    if (!containerRef.current || loading) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030508);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(8, 6, 12);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 30;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.3;
    controlsRef.current = controls;

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
    scene.add(ambientLight);

    // Point lights for glow effect
    const light1 = new THREE.PointLight(0x00D4FF, 2, 50);
    light1.position.set(10, 10, 10);
    scene.add(light1);

    const light2 = new THREE.PointLight(0x7B68EE, 1.5, 50);
    light2.position.set(-10, -5, -10);
    scene.add(light2);

    // Create tesseract structure
    createTesseract(scene, sections, sectionData);

    // Raycaster for interaction
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(cubesRef.current, true);

      if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj && !obj.userData.sectionName) {
          obj = obj.parent;
        }
        if (obj?.userData.sectionName) {
          handleCubeClick(obj.userData.sectionName);
        }
      }
    };

    renderer.domElement.addEventListener('click', handleClick);

    // Animation loop
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      controls.update();
      
      // Animate graph nodes inside cubes
      const time = Date.now() * 0.001;
      Object.values(graphNodesRef.current).forEach(group => {
        if (group.children) {
          group.children.forEach((node, i) => {
            if (node.material) {
              node.material.opacity = 0.6 + Math.sin(time + i * 0.5) * 0.3;
            }
          });
        }
      });

      // Animate cube edges glow
      cubesRef.current.forEach(cube => {
        if (cube.userData.edgeMesh) {
          cube.userData.edgeMesh.material.opacity = 0.7 + Math.sin(time * 2) * 0.2;
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('click', handleClick);
      cancelAnimationFrame(rafRef.current);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [loading, sections, sectionData]);

  // Create tesseract/hypercube structure
  const createTesseract = useCallback((scene, sections, data) => {
    cubesRef.current = [];
    graphNodesRef.current = {};

    const count = sections.length;
    
    // Calculate positions for cubes in a tesseract-like arrangement
    const positions = getTesseractPositions(count);
    
    sections.forEach((section, i) => {
      const pos = positions[i];
      const color = new THREE.Color(CUBE_COLORS[i % CUBE_COLORS.length]);
      const isCurrent = section.nombre === currentSection;
      
      // Create glass cube
      const cubeGroup = createGlassCube(
        pos,
        2.5, // size
        color,
        section.nombre,
        isCurrent,
        data[section.nombre]
      );
      
      scene.add(cubeGroup);
      cubesRef.current.push(cubeGroup);
    });

    // Create connecting edges between cubes (tesseract structure)
    if (count > 1) {
      createTesseractEdges(scene, positions);
    }
  }, [currentSection]);

  // Get positions for tesseract arrangement
  const getTesseractPositions = (count) => {
    const positions = [];
    const spacing = 5;

    if (count === 1) {
      positions.push(new THREE.Vector3(0, 0, 0));
    } else if (count === 2) {
      positions.push(new THREE.Vector3(-spacing/2, 0, 0));
      positions.push(new THREE.Vector3(spacing/2, 0, 0));
    } else if (count <= 4) {
      // Square arrangement
      const offsets = [
        [-1, 0, -1], [1, 0, -1],
        [-1, 0, 1], [1, 0, 1]
      ];
      for (let i = 0; i < count; i++) {
        const [x, y, z] = offsets[i];
        positions.push(new THREE.Vector3(x * spacing/2, y, z * spacing/2));
      }
    } else if (count <= 8) {
      // Cube arrangement (vertices of a cube)
      const offsets = [
        [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]
      ];
      for (let i = 0; i < count; i++) {
        const [x, y, z] = offsets[i];
        positions.push(new THREE.Vector3(x * spacing/2, y * spacing/2, z * spacing/2));
      }
    } else {
      // Spherical distribution for many cubes
      for (let i = 0; i < count; i++) {
        const phi = Math.acos(-1 + (2 * i) / count);
        const theta = Math.sqrt(count * Math.PI) * phi;
        positions.push(new THREE.Vector3(
          spacing * Math.cos(theta) * Math.sin(phi),
          spacing * Math.sin(theta) * Math.sin(phi),
          spacing * Math.cos(phi)
        ));
      }
    }

    return positions;
  };

  // Create a glass cube with neon edges and graph inside
  const createGlassCube = (position, size, color, sectionName, isCurrent, graphData) => {
    const group = new THREE.Group();
    group.position.copy(position);
    group.userData.sectionName = sectionName;
    group.userData.isCurrent = isCurrent;

    // Glass faces (semi-transparent)
    const glassGeometry = new THREE.BoxGeometry(size, size, size);
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x101520,
      transparent: true,
      opacity: 0.15,
      roughness: 0.1,
      metalness: 0.1,
      transmission: 0.9,
      thickness: 0.5,
      side: THREE.DoubleSide,
    });
    const glassCube = new THREE.Mesh(glassGeometry, glassMaterial);
    group.add(glassCube);

    // Neon edges (wireframe)
    const edgeGeometry = new THREE.EdgesGeometry(glassGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.9,
      linewidth: 2,
    });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    group.add(edges);
    group.userData.edgeMesh = edges;

    // Outer glow (slightly larger wireframe)
    const glowGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(size * 1.02, size * 1.02, size * 1.02));
    const glowMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.3,
    });
    const glowEdges = new THREE.LineSegments(glowGeometry, glowMaterial);
    group.add(glowEdges);

    // Inner cube (nested tesseract effect)
    const innerSize = size * 0.4;
    const innerGlassGeometry = new THREE.BoxGeometry(innerSize, innerSize, innerSize);
    const innerGlassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x101520,
      transparent: true,
      opacity: 0.1,
      roughness: 0.1,
      transmission: 0.95,
      side: THREE.DoubleSide,
    });
    const innerGlass = new THREE.Mesh(innerGlassGeometry, innerGlassMaterial);
    group.add(innerGlass);

    const innerEdgeGeometry = new THREE.EdgesGeometry(innerGlassGeometry);
    const innerEdgeMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.6,
    });
    const innerEdges = new THREE.LineSegments(innerEdgeGeometry, innerEdgeMaterial);
    group.add(innerEdges);

    // Connecting lines between inner and outer cube (tesseract diagonals)
    const vertices = [
      [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]
    ];
    const diagonalGeometry = new THREE.BufferGeometry();
    const diagonalPositions = [];
    vertices.forEach(([x, y, z]) => {
      diagonalPositions.push(x * size/2, y * size/2, z * size/2);
      diagonalPositions.push(x * innerSize/2, y * innerSize/2, z * innerSize/2);
    });
    diagonalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(diagonalPositions, 3));
    const diagonalMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.25,
    });
    const diagonals = new THREE.LineSegments(diagonalGeometry, diagonalMaterial);
    group.add(diagonals);

    // Graph nodes inside the cube
    if (graphData?.nodes?.length > 0) {
      const nodesGroup = new THREE.Group();
      
      // Normalize node positions to fit inside inner cube
      const nodePositions = graphData.nodes.map(n => {
        return new THREE.Vector3(
          n.x * innerSize * 0.9,
          n.y * innerSize * 0.9,
          n.z * innerSize * 0.9
        );
      });

      // Create node spheres
      const nodeGeometry = new THREE.SphereGeometry(0.06, 8, 8);
      nodePositions.forEach((pos, i) => {
        const nodeMaterial = new THREE.MeshBasicMaterial({
          color: color,
          transparent: true,
          opacity: 0.8,
        });
        const nodeMesh = new THREE.Mesh(nodeGeometry, nodeMaterial);
        nodeMesh.position.copy(pos);
        nodesGroup.add(nodeMesh);
      });

      // Create edge lines
      if (graphData.links?.length > 0) {
        const nodeMap = new Map(graphData.nodes.map((n, i) => [n.id, i]));
        const linkGeometry = new THREE.BufferGeometry();
        const linkPositions = [];
        
        graphData.links.slice(0, 100).forEach(link => {
          const sourceIdx = nodeMap.get(link.source ?? link.origen);
          const targetIdx = nodeMap.get(link.target ?? link.destino);
          if (sourceIdx !== undefined && targetIdx !== undefined) {
            const sp = nodePositions[sourceIdx];
            const tp = nodePositions[targetIdx];
            if (sp && tp) {
              linkPositions.push(sp.x, sp.y, sp.z, tp.x, tp.y, tp.z);
            }
          }
        });

        if (linkPositions.length > 0) {
          linkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linkPositions, 3));
          const linkMaterial = new THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.2,
          });
          const links = new THREE.LineSegments(linkGeometry, linkMaterial);
          nodesGroup.add(links);
        }
      }

      group.add(nodesGroup);
      graphNodesRef.current[sectionName] = nodesGroup;
    }

    // Current section indicator (ring)
    if (isCurrent) {
      const ringGeometry = new THREE.RingGeometry(size * 0.7, size * 0.75, 32);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x00FFFF,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -size / 2 - 0.2;
      group.add(ring);
    }

    // Label
    createLabel(group, sectionName, size, graphData?.count || 0);

    return group;
  };

  // Create text label for cube
  const createLabel = (group, text, cubeSize, count) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;

    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = 'bold 28px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(text.charAt(0).toUpperCase() + text.slice(1), canvas.width / 2, 32);
    
    ctx.font = '18px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#00D4FF';
    ctx.fillText(`${count} nodos`, canvas.width / 2, 54);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(2.5, 0.6, 1);
    sprite.position.y = cubeSize / 2 + 0.8;
    group.add(sprite);
  };

  // Create connecting edges between cubes
  const createTesseractEdges = (scene, positions) => {
    const geometry = new THREE.BufferGeometry();
    const posArray = [];

    // Connect adjacent cubes
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist = positions[i].distanceTo(positions[j]);
        if (dist < 8) { // Only connect nearby cubes
          posArray.push(
            positions[i].x, positions[i].y, positions[i].z,
            positions[j].x, positions[j].y, positions[j].z
          );
        }
      }
    }

    if (posArray.length > 0) {
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));
      const material = new THREE.LineBasicMaterial({
        color: 0x00D4FF,
        transparent: true,
        opacity: 0.15,
      });
      const lines = new THREE.LineSegments(geometry, material);
      scene.add(lines);
    }
  };

  // Handle cube click
  const handleCubeClick = useCallback((sectionName) => {
    if (focusedCube === sectionName) {
      // Second click: enter the section
      if (onSelectSection) {
        onSelectSection(sectionName);
      }
    } else {
      // First click: focus on cube
      setFocusedCube(sectionName);
      setHintText(`${sectionName.charAt(0).toUpperCase() + sectionName.slice(1)} · Click de nuevo para entrar`);
      
      // Animate camera to focus on cube
      const cube = cubesRef.current.find(c => c.userData.sectionName === sectionName);
      if (cube && cameraRef.current && controlsRef.current) {
        const targetPos = cube.position.clone();
        controlsRef.current.target.copy(targetPos);
        controlsRef.current.autoRotate = false;
      }
    }
  }, [focusedCube, onSelectSection]);

  return (
    <div className="mv-tesseract">
      {/* Header */}
      <header className="mv-tesseract-header">
        <div className="mv-tesseract-title">
          <span className="mv-tesseract-icon">◈</span>
          <span>Multiverso</span>
          <span className="mv-tesseract-count">{sections.length} dimensiones</span>
        </div>
        <button className="mv-tesseract-close" onClick={onClose}>✕</button>
      </header>

      {/* 3D Scene */}
      <div className="mv-tesseract-scene" ref={containerRef}>
        {loading && (
          <div className="mv-tesseract-loading">
            <div className="mv-tesseract-spinner" />
            <span>Construyendo Multiverso...</span>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <footer className="mv-tesseract-footer">
        <span>{hintText}</span>
      </footer>
    </div>
  );
}
