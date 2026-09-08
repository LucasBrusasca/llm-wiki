import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/* ══════════════════════════════════════════════════════════════════════════
   MULTIVERSO — Glass Tesseract Art Installation
   
   Visual target: Dense glowing glass hypercube with neon edges.
   Each dimension = a cell/volume within a cohesive tesseract structure.
   Graph nodes visible inside as glowing particles.
   ══════════════════════════════════════════════════════════════════════════ */

const DIMENSION_COLORS = [
  new THREE.Color(0x00FFFF), // cyan
  new THREE.Color(0x00FF88), // green
  new THREE.Color(0xFF00FF), // magenta
  new THREE.Color(0xFFAA00), // orange
  new THREE.Color(0x8888FF), // blue
  new THREE.Color(0xFF88AA), // pink
];

export default function MultiverseMap({
  sections,
  onSelectSection,
  onClose,
  currentSection
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const composerRef = useRef(null);
  const cubeGroupsRef = useRef([]);
  const rafRef = useRef(null);
  
  const [loading, setLoading] = useState(true);
  const [focusedCube, setFocusedCube] = useState(null);
  const [sectionData, setSectionData] = useState({});
  const [hintText, setHintText] = useState('Orbita para explorar · Click en un cubo para enfocar');

  // Load graph data for each section
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const data = {};
      
      for (const section of sections) {
        try {
          const r = await fetch(`/api/graph?seccion=${encodeURIComponent(section.nombre)}`);
          const json = await r.json();
          const nodes = (json.nodos || []).slice(0, 80).map(n => ({
            id: n.id,
            x: (n.x3d ?? (Math.random() - 0.5)) * 2,
            y: (n.y3d ?? (Math.random() - 0.5)) * 2,
            z: (n.z3d ?? (Math.random() - 0.5)) * 2,
          }));
          const links = (json.relaciones || []).slice(0, 120);
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

  // Main Three.js scene
  useEffect(() => {
    if (!containerRef.current || loading) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene with black background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(12, 8, 14);
    camera.lookAt(0, 0, 0);

    // Renderer with high quality
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      alpha: false,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    container.appendChild(renderer.domElement);

    // Post-processing with BLOOM for neon glow
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      1.5,   // strength - STRONG bloom
      0.4,   // radius
      0.1    // threshold - low to catch all glowing materials
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    composerRef.current = composer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 6;
    controls.maxDistance = 40;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    // Lighting for glass materials
    const ambientLight = new THREE.AmbientLight(0x404060, 0.3);
    scene.add(ambientLight);

    const light1 = new THREE.PointLight(0x00FFFF, 3, 100);
    light1.position.set(15, 15, 15);
    scene.add(light1);

    const light2 = new THREE.PointLight(0xFF00FF, 2, 100);
    light2.position.set(-15, -10, -15);
    scene.add(light2);

    const light3 = new THREE.PointLight(0xFFFFFF, 1.5, 100);
    light3.position.set(0, 20, 0);
    scene.add(light3);

    // Create the tesseract structure
    cubeGroupsRef.current = [];
    createTesseractStructure(scene, sections, sectionData, currentSection);

    // Raycaster for interaction
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(cubeGroupsRef.current, true);

      if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj && !obj.userData.sectionName) {
          obj = obj.parent;
        }
        if (obj?.userData.sectionName) {
          handleCubeClick(obj.userData.sectionName, controls);
        }
      }
    };

    renderer.domElement.addEventListener('click', handleClick);

    // Animation loop
    const clock = new THREE.Clock();
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const time = clock.getElapsedTime();
      
      controls.update();
      
      // Animate glowing elements
      cubeGroupsRef.current.forEach((group, i) => {
        if (group.userData.glowMeshes) {
          group.userData.glowMeshes.forEach((mesh, j) => {
            if (mesh.material.emissiveIntensity !== undefined) {
              mesh.material.emissiveIntensity = 0.8 + Math.sin(time * 2 + i + j * 0.5) * 0.4;
            }
          });
        }
        // Subtle rotation for each cube
        if (group.userData.innerGroup) {
          group.userData.innerGroup.rotation.y = time * 0.1 + i * 0.5;
          group.userData.innerGroup.rotation.x = Math.sin(time * 0.15 + i) * 0.1;
        }
      });

      composer.render();
    };
    animate();

    // Resize handler
    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('click', handleClick);
      cancelAnimationFrame(rafRef.current);
      controls.dispose();
      renderer.dispose();
      composer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [loading, sections, sectionData, currentSection]);

  // Create the main tesseract structure
  const createTesseractStructure = useCallback((scene, sections, data, currentSection) => {
    const count = sections.length;
    
    // Position cubes in a tesseract-like arrangement
    const positions = [];
    const spacing = 6;
    
    if (count === 1) {
      positions.push(new THREE.Vector3(0, 0, 0));
    } else if (count === 2) {
      positions.push(new THREE.Vector3(-spacing/2, 0, 0));
      positions.push(new THREE.Vector3(spacing/2, 0, 0));
    } else if (count <= 4) {
      const offsets = [[-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1]];
      for (let i = 0; i < count; i++) {
        const [x, y, z] = offsets[i];
        positions.push(new THREE.Vector3(x * spacing/2, y, z * spacing/2));
      }
    } else {
      const offsets = [
        [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]
      ];
      for (let i = 0; i < count; i++) {
        const [x, y, z] = offsets[i % 8];
        positions.push(new THREE.Vector3(x * spacing/2, y * spacing/2, z * spacing/2));
      }
    }

    // Create each dimension cube
    sections.forEach((section, i) => {
      const pos = positions[i];
      const color = DIMENSION_COLORS[i % DIMENSION_COLORS.length];
      const isCurrent = section.nombre === currentSection;
      const graphData = data[section.nombre];
      
      const cubeGroup = createGlassTesseractCube(
        pos,
        3.5,
        color,
        section.nombre,
        isCurrent,
        graphData
      );
      
      scene.add(cubeGroup);
      cubeGroupsRef.current.push(cubeGroup);
    });

    // Create connecting beams between cubes (tesseract edges)
    createInterCubeConnections(scene, positions);
  }, []);

  // Create a single glass tesseract cube with nested structure
  const createGlassTesseractCube = (position, size, color, sectionName, isCurrent, graphData) => {
    const group = new THREE.Group();
    group.position.copy(position);
    group.userData.sectionName = sectionName;
    group.userData.glowMeshes = [];
    
    const innerGroup = new THREE.Group();
    group.userData.innerGroup = innerGroup;

    // === OUTER CUBE (Glass + Neon Edges) ===
    
    // Glass faces - MeshPhysicalMaterial for realistic glass
    const glassGeometry = new THREE.BoxGeometry(size, size, size);
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x111122,
      transparent: true,
      opacity: 0.15,
      roughness: 0.05,
      metalness: 0.1,
      transmission: 0.95,
      thickness: 0.5,
      envMapIntensity: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      side: THREE.DoubleSide,
    });
    const glassCube = new THREE.Mesh(glassGeometry, glassMaterial);
    innerGroup.add(glassCube);

    // NEON EDGES - Thick glowing tubes
    const edgeRadius = 0.08;
    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 1,
    });
    
    // Create tube edges for outer cube
    const outerEdges = createCubeEdgeTubes(size, edgeRadius, edgeMaterial);
    outerEdges.forEach(edge => innerGroup.add(edge));
    group.userData.glowMeshes.push(...outerEdges);

    // === INNER CUBE (Nested tesseract) ===
    const innerSize = size * 0.35;
    
    const innerGlassGeometry = new THREE.BoxGeometry(innerSize, innerSize, innerSize);
    const innerGlassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x222244,
      transparent: true,
      opacity: 0.2,
      roughness: 0.05,
      transmission: 0.9,
      thickness: 0.3,
      side: THREE.DoubleSide,
    });
    const innerGlass = new THREE.Mesh(innerGlassGeometry, innerGlassMaterial);
    innerGroup.add(innerGlass);

    // Inner cube neon edges
    const innerEdgeMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color().copy(color).multiplyScalar(0.8),
      transparent: true,
      opacity: 0.9,
    });
    const innerEdges = createCubeEdgeTubes(innerSize, edgeRadius * 0.7, innerEdgeMaterial);
    innerEdges.forEach(edge => innerGroup.add(edge));
    group.userData.glowMeshes.push(...innerEdges);

    // === DIAGONAL CONNECTORS (Tesseract vertex connections) ===
    const diagonalMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.6,
    });
    
    const vertices = [
      [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]
    ];
    
    vertices.forEach(([x, y, z]) => {
      const outerPoint = new THREE.Vector3(x * size/2, y * size/2, z * size/2);
      const innerPoint = new THREE.Vector3(x * innerSize/2, y * innerSize/2, z * innerSize/2);
      
      const tube = createTubeBetweenPoints(outerPoint, innerPoint, edgeRadius * 0.5, diagonalMaterial);
      innerGroup.add(tube);
      group.userData.glowMeshes.push(tube);
    });

    // === GRAPH NODES INSIDE ===
    if (graphData?.nodes?.length > 0) {
      const graphGroup = createGraphVisualization(graphData, innerSize * 0.85, color);
      innerGroup.add(graphGroup);
      group.userData.glowMeshes.push(...graphGroup.children);
    }

    group.add(innerGroup);

    // === CURRENT SECTION INDICATOR ===
    if (isCurrent) {
      const ringGeometry = new THREE.TorusGeometry(size * 0.6, 0.1, 8, 32);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x00FFFF,
        transparent: true,
        opacity: 0.9,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -size / 2 - 0.3;
      group.add(ring);
      group.userData.glowMeshes.push(ring);
    }

    // === LABEL ===
    createLabel(group, sectionName, size, graphData?.count || 0, color);

    return group;
  };

  // Create tube edges for a cube
  const createCubeEdgeTubes = (size, radius, material) => {
    const edges = [];
    const half = size / 2;
    
    // Define all 12 edges of a cube
    const edgeDefinitions = [
      // Bottom face
      [[-half, -half, -half], [half, -half, -half]],
      [[half, -half, -half], [half, -half, half]],
      [[half, -half, half], [-half, -half, half]],
      [[-half, -half, half], [-half, -half, -half]],
      // Top face
      [[-half, half, -half], [half, half, -half]],
      [[half, half, -half], [half, half, half]],
      [[half, half, half], [-half, half, half]],
      [[-half, half, half], [-half, half, -half]],
      // Vertical edges
      [[-half, -half, -half], [-half, half, -half]],
      [[half, -half, -half], [half, half, -half]],
      [[half, -half, half], [half, half, half]],
      [[-half, -half, half], [-half, half, half]],
    ];

    edgeDefinitions.forEach(([start, end]) => {
      const tube = createTubeBetweenPoints(
        new THREE.Vector3(...start),
        new THREE.Vector3(...end),
        radius,
        material.clone()
      );
      edges.push(tube);
    });

    return edges;
  };

  // Create a tube between two points
  const createTubeBetweenPoints = (start, end, radius, material) => {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1);
    const mesh = new THREE.Mesh(geometry, material);
    
    mesh.position.copy(start).add(direction.multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.clone().normalize()
    );
    
    return mesh;
  };

  // Create graph visualization inside cube
  const createGraphVisualization = (graphData, size, color) => {
    const graphGroup = new THREE.Group();
    
    // Normalize positions to fit inside
    const nodes = graphData.nodes;
    if (nodes.length === 0) return graphGroup;
    
    // Find bounds
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    nodes.forEach(n => {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
      minZ = Math.min(minZ, n.z); maxZ = Math.max(maxZ, n.z);
    });
    
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const rangeZ = maxZ - minZ || 1;
    const maxRange = Math.max(rangeX, rangeY, rangeZ);
    
    // Create node spheres - BIGGER and BRIGHTER
    const nodePositions = [];
    const nodeSphereGeometry = new THREE.SphereGeometry(0.12, 12, 12);
    const nodeMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.95,
    });

    nodes.forEach((node, i) => {
      const pos = new THREE.Vector3(
        ((node.x - minX) / maxRange - 0.5) * size,
        ((node.y - minY) / maxRange - 0.5) * size,
        ((node.z - minZ) / maxRange - 0.5) * size
      );
      nodePositions.push({ id: node.id, pos });
      
      const sphere = new THREE.Mesh(nodeSphereGeometry, nodeMaterial.clone());
      sphere.position.copy(pos);
      graphGroup.add(sphere);
    });

    // Create edges as lines
    if (graphData.links?.length > 0) {
      const nodeMap = new Map(nodePositions.map(n => [n.id, n.pos]));
      const lineMaterial = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.4,
      });

      graphData.links.slice(0, 80).forEach(link => {
        const sourceId = link.source ?? link.origen;
        const targetId = link.target ?? link.destino;
        const sourcePos = nodeMap.get(sourceId);
        const targetPos = nodeMap.get(targetId);
        
        if (sourcePos && targetPos) {
          const geometry = new THREE.BufferGeometry().setFromPoints([sourcePos, targetPos]);
          const line = new THREE.Line(geometry, lineMaterial);
          graphGroup.add(line);
        }
      });
    }

    return graphGroup;
  };

  // Create connections between cubes
  const createInterCubeConnections = (scene, positions) => {
    if (positions.length < 2) return;

    const lineMaterial = new THREE.MeshBasicMaterial({
      color: 0x00AAFF,
      transparent: true,
      opacity: 0.3,
    });

    // Connect adjacent cubes
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist = positions[i].distanceTo(positions[j]);
        if (dist < 10) {
          const tube = createTubeBetweenPoints(
            positions[i],
            positions[j],
            0.04,
            lineMaterial.clone()
          );
          scene.add(tube);
        }
      }
    }
  };

  // Create text label
  const createLabel = (group, text, cubeSize, count, color) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 128;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.roundRect(0, 0, canvas.width, canvas.height, 16);
    ctx.fill();

    // Text
    ctx.font = 'bold 48px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.charAt(0).toUpperCase() + text.slice(1), canvas.width / 2, 50);
    
    ctx.font = '32px Inter, system-ui, sans-serif';
    ctx.fillStyle = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
    ctx.fillText(`${count} nodos`, canvas.width / 2, 95);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(4, 1, 1);
    sprite.position.y = cubeSize / 2 + 1.2;
    group.add(sprite);
  };

  // Handle cube click
  const handleCubeClick = useCallback((sectionName, controls) => {
    if (focusedCube === sectionName) {
      // Second click: enter the section
      if (onSelectSection) {
        onSelectSection(sectionName);
      }
    } else {
      // First click: focus on cube
      setFocusedCube(sectionName);
      setHintText(`${sectionName.charAt(0).toUpperCase() + sectionName.slice(1)} · Click de nuevo para entrar`);
      
      // Find and focus on cube
      const cube = cubeGroupsRef.current.find(c => c.userData.sectionName === sectionName);
      if (cube && controls) {
        controls.target.copy(cube.position);
        controls.autoRotate = false;
      }
    }
  }, [focusedCube, onSelectSection]);

  return (
    <div className="mv-tesseract">
      <header className="mv-tesseract-header">
        <div className="mv-tesseract-title">
          <span className="mv-tesseract-icon">◈</span>
          <span>Multiverso</span>
          <span className="mv-tesseract-count">{sections.length} dimensiones</span>
        </div>
        <button className="mv-tesseract-close" onClick={onClose}>✕</button>
      </header>

      <div className="mv-tesseract-scene" ref={containerRef}>
        {loading && (
          <div className="mv-tesseract-loading">
            <div className="mv-tesseract-spinner" />
            <span>Construyendo Multiverso...</span>
          </div>
        )}
      </div>

      <footer className="mv-tesseract-footer">
        <span>{hintText}</span>
      </footer>
    </div>
  );
}
