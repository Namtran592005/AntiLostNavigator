import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  TextInput,
  StatusBar,
  Modal,
  Platform,
  KeyboardAvoidingView,
  Image,
  ScrollView,
  Linking,
  useWindowDimensions,
  ActivityIndicator,
  Dimensions,
  PanResponder,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { Magnetometer, DeviceMotion } from "expo-sensors";
import * as SQLite from "expo-sqlite";
import NetInfo from "@react-native-community/netinfo";
import { Feather, FontAwesome5 } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";
import Svg, {
  Circle,
  Line,
  Image as SvgImage,
  Rect,
  Text as SvgText,
  G,
  Polyline,
} from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";

const toRad = (v) => (v * Math.PI) / 180;
const toDeg = (v) => (v * 180) / Math.PI;

const haversineDistance = (p1, p2) => {
  const R = 6371e3;
  const dLat = toRad(p2.latitude - p1.latitude);
  const dLon = toRad(p2.longitude - p1.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(p1.latitude)) *
      Math.cos(toRad(p2.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const calculateBearing = (start, end) => {
  const startLat = toRad(start.latitude);
  const startLon = toRad(start.longitude);
  const endLat = toRad(end.latitude);
  const endLon = toRad(end.longitude);
  const y = Math.sin(endLon - startLon) * Math.cos(endLat);
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLon - startLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

class KalmanFilter1D {
  constructor() {
    this.pos = 0;
    this.vel = 0;
    this.Ppos = 100;
    this.Pvel = 1;
    this.Qpos = 4e-10;
    this.Qvel = 1e-9;
    this.lastT = null;
    this.initialized = false;
  }
  init(pos, t) {
    this.pos = pos;
    this.vel = 0;
    this.Ppos = 100;
    this.Pvel = 1;
    this.lastT = t;
    this.initialized = true;
  }
  update(z, accuracy, t) {
    if (!this.initialized) {
      this.init(z, t);
      return z;
    }
    const dt = Math.min((t - this.lastT) / 1000, 10);
    this.lastT = t;
    if (dt <= 0) return this.pos;
    this.pos += this.vel * dt;
    this.Ppos += this.Pvel * dt * dt + this.Qpos;
    this.Pvel += this.Qvel;
    // FIX v1.1.1: R quá nhỏ (1e-10) khiến Kalman "tin" mô hình cũ hơn GPS mới,
    // gây vị trí lọc tụt sau người dùng ~2-6m khi đi bộ => bearing sai lệch.
    // Tăng R ~100x để theo kịp vị trí thật nhưng vẫn giảm nhiễu.
    const R = Math.max(accuracy, 1) ** 2 * 1e-8;
    const K = this.Ppos / (this.Ppos + R);
    const innov = z - this.pos;
    this.pos += K * innov;
    if (dt > 0.05) this.vel += ((K * innov) / dt) * 0.08;
    this.Ppos = Math.max((1 - K) * this.Ppos, 1e-15);
    this.Pvel = Math.max(this.Pvel * 0.95, 1e-12);
    return this.pos;
  }
  reset() {
    this.initialized = false;
  }
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const db = SQLite.openDatabaseSync("antilost_v2.db");

// --------------------------- MULTILANGUAGE ---------------------------
const translations = {
  vi: {
    appName: "AntiLost Navigator",
    tabNav: "Dẫn đường",
    tabList: "Danh sách mốc",
    tabTime: "Thời gian",
    tab2D: "2D",
    noTarget: "Chưa chọn mục tiêu",
    selectTargetHint: "Hãy sang tab 'Danh sách mốc' để chọn mục tiêu",
    headingTo: "Đang hướng về",
    turnRight: "Xoay sang PHẢI",
    turnLeft: "Xoay sang TRÁI",
    correctHeading: "Đang đi đúng hướng",
    distance: "khoảng cách",
    bearingError: "lệch hướng",
    cancelNav: "Hủy dẫn đường",
    deleteWaypoint: "Xóa mốc này",
    disclaimer:
      "⚠️ Vị trí có thể sai số ±3-5m. Hãy kết hợp quan sát thực tế và kỹ năng định hướng.",
    gpsStable: "GPS Ổn định",
    gpsSearching: "Đang tìm GPS",
    gpsGood: "Tốt",
    gpsAverage: "TB",
    gpsPoor: "Kém",
    signalLost: "Mất sóng",
    signalWifi: "Wi-Fi",
    signalCellular: "Di động",
    signalConnected: "Có kết nối",
    speedUnit: "km/h",
    compass: "Compass",
    myMarkers: "Mốc của tôi",
    emptyMarkers: "Bạn chưa lưu mốc nào",
    addFirst: "+ Thêm mốc đầu tiên",
    exportGeoJSON: "Xuất GeoJSON",
    importGeoJSON: "Nhập GeoJSON",
    addMarker: "Thêm mốc mới",
    markerName: "Tên mốc (Bắt buộc)",
    markerNote: "Ghi chú (Tùy chọn)",
    markerPhoto: "Ảnh mốc (Tùy chọn)",
    takePhoto: "Chụp ảnh mốc",
    saveMarker: "Lưu mốc hiện tại",
    acquiringGPS: "Đang xác định vị trí chính xác...",
    gpsReady: "GPS sẵn sàng",
    retry: "Thử lại",
    utc: "UTC",
    localTime: "Giờ địa phương",
    sun: "Mặt trời",
    sunrise: "Mọc",
    sunset: "Lặn",
    gpsImproved: "GPS được cải thiện",
    accuracy: "Độ chính xác hiện tại",
    arrived: "Đã đến nơi!",
    arrivedMessage: "Bạn đang ở khu vực mốc",
    chooseAnother: "Chọn mốc khác",
    close: "Đóng",
    ok: "OK",
    cancel: "Hủy",
    deleteConfirm: "Bạn chắc chắn muốn xóa?",
    delete: "Xóa",
    networkRestored: "Đã bắt được sóng!",
    networkRestoredMsg:
      "Bạn đang ở gần khu vực có người.\nHãy nhìn xung quanh để tìm sự trợ giúp.",
    gpsCalibrated: "GPS được cải thiện",
    gpsCalibratedMsg: "Độ chính xác hiện tại: ±",
    meter: "m",
    sample: "mẫu",
    holdSteady: "Giữ yên thiết bị để có kết quả tốt nhất",
    language: "Ngôn ngữ",
    selectLanguage: "Chọn ngôn ngữ",
    vietnamese: "Tiếng Việt",
    english: "English",
    chinese: "中文",
    french: "Français",
    spanish: "Español",
    korean: "한국어",
    exportSuccess: "Xuất thành công",
    importSuccess: "Nhập thành công",
    importing: "Đang nhập...",
    exporting: "Đang xuất...",
    gpsNotAvailable: "Không lấy được GPS",
    permissionRequired: "Cần quyền vị trí",
    gpsError: "Lỗi GPS",
    cameraPermission: "Cần quyền camera",
    saveImageError: "Lỗi lưu ảnh",
    addSuccess: "Đã lưu mốc!",
    addSuccessMsg: "Độ chính xác: ±",
    addedMarkers: "Đã thêm",
    markers: "mốc",
    invalidGeoJSON: "Sai định dạng GeoJSON",
    shareNotAvailable: "Không thể chia sẻ",
    gpsFallback: "Không lấy được GPS, dùng vị trí cũ",
    preparingGPS: "Đang ổn định vị trí GPS...",
    meterShort: "m",
    kmShort: "km",
    offCourse: "lệch hướng",
    waypointDeleted: "Đã xóa mốc",
    gpsWaiting: "Đang lấy vị trí...",
    gpsDetails: "Chi tiết GPS",
    networkDetails: "Chi tiết mạng",
    rawLatitude: "Vĩ độ thô",
    rawLongitude: "Kinh độ thô",
    filtered: "Đã lọc",
    satellites: "Số vệ tinh",
    provider: "Nhà cung cấp",
    networkType: "Loại mạng",
    signalStrength: "Cường độ tín hiệu",
    carrier: "Nhà mạng",
    ipAddress: "Địa chỉ IP",
  },
  en: {
    appName: "AntiLost Navigator",
    tabNav: "Navigate",
    tabList: "Markers",
    tabTime: "Time",
    tab2D: "2D",
    noTarget: "No target selected",
    selectTargetHint: "Go to 'Markers' tab to select a target",
    headingTo: "Heading to",
    turnRight: "Turn RIGHT",
    turnLeft: "Turn LEFT",
    correctHeading: "On correct heading",
    distance: "distance",
    bearingError: "off course",
    cancelNav: "Cancel navigation",
    deleteWaypoint: "Delete marker",
    disclaimer:
      "⚠️ Position error ±3-5m. Use visual observation and navigation skills.",
    gpsStable: "GPS stable",
    gpsSearching: "Searching GPS",
    gpsGood: "Good",
    gpsAverage: "Avg",
    gpsPoor: "Poor",
    signalLost: "No signal",
    signalWifi: "Wi-Fi",
    signalCellular: "Cellular",
    signalConnected: "Connected",
    speedUnit: "km/h",
    compass: "Compass",
    myMarkers: "My markers",
    emptyMarkers: "No markers saved",
    addFirst: "+ Add first marker",
    exportGeoJSON: "Export GeoJSON",
    importGeoJSON: "Import GeoJSON",
    addMarker: "Add new marker",
    markerName: "Marker name (Required)",
    markerNote: "Note (Optional)",
    markerPhoto: "Marker photo (Optional)",
    takePhoto: "Take photo",
    saveMarker: "Save current location",
    acquiringGPS: "Accurate positioning...",
    gpsReady: "GPS ready",
    retry: "Retry",
    utc: "UTC",
    localTime: "Local time",
    sun: "Sun",
    sunrise: "Sunrise",
    sunset: "Sunset",
    gpsImproved: "GPS improved",
    accuracy: "Current accuracy",
    arrived: "Arrived!",
    arrivedMessage: "You are near marker",
    chooseAnother: "Choose another",
    close: "Close",
    ok: "OK",
    cancel: "Cancel",
    deleteConfirm: "Are you sure you want to delete?",
    delete: "Delete",
    networkRestored: "Network restored!",
    networkRestoredMsg: "You are near populated area.\nLook around for help.",
    gpsCalibrated: "GPS improved",
    gpsCalibratedMsg: "Current accuracy: ±",
    meter: "m",
    sample: "samples",
    holdSteady: "Keep device still for best results",
    language: "Language",
    selectLanguage: "Select language",
    vietnamese: "Vietnamese",
    english: "English",
    chinese: "Chinese",
    french: "French",
    spanish: "Spanish",
    korean: "Korean",
    exportSuccess: "Export successful",
    importSuccess: "Import successful",
    importing: "Importing...",
    exporting: "Exporting...",
    gpsNotAvailable: "GPS not available",
    permissionRequired: "Location permission required",
    gpsError: "GPS error",
    cameraPermission: "Camera permission required",
    saveImageError: "Save image error",
    addSuccess: "Marker saved!",
    addSuccessMsg: "Accuracy: ±",
    addedMarkers: "Added",
    markers: "markers",
    invalidGeoJSON: "Invalid GeoJSON",
    shareNotAvailable: "Sharing not available",
    gpsFallback: "Cannot get GPS, using old location",
    preparingGPS: "Stabilizing GPS position...",
    meterShort: "m",
    kmShort: "km",
    offCourse: "off course",
    waypointDeleted: "Marker deleted",
    gpsWaiting: "Getting location...",
    gpsDetails: "GPS Details",
    networkDetails: "Network Details",
    rawLatitude: "Raw latitude",
    rawLongitude: "Raw longitude",
    filtered: "Filtered",
    satellites: "Satellites",
    provider: "Provider",
    networkType: "Network type",
    signalStrength: "Signal strength",
    carrier: "Carrier",
    ipAddress: "IP address",
    mapLayer: "Map layer",
    layerSatellite: "Satellite",
    layerStreet: "Street",
    layerNone: "None",
    offlineTiles: "Offline",
    downloadArea: "Download area around markers",
    downloadingTiles: "Downloading tiles",
    tilesReady: "Offline map ready",
    tilesDownloaded: "tiles downloaded",
    tileDownloadFail: "Tile download error",
    offlineBadge: "OFFLINE",
    mapAttribution: "Sources: Esri, Maxar, Earthstar Geographics, GIS User Community",
  },
  zh: {
    appName: "防迷失导航仪",
    tabNav: "导航",
    tabList: "标记点",
    tabTime: "时间",
    tab2D: "二维地图",
    noTarget: "未选择目标",
    selectTargetHint: "前往「标记点」标签选择目标",
    headingTo: "前往",
    turnRight: "向右转",
    turnLeft: "向左转",
    correctHeading: "方向正确",
    distance: "距离",
    bearingError: "偏离方向",
    cancelNav: "取消导航",
    deleteWaypoint: "删除标记",
    disclaimer: "⚠️ 位置误差 ±3-5米。请结合实地观察和定向技能。",
    gpsStable: "GPS稳定",
    gpsSearching: "搜索GPS",
    gpsGood: "良好",
    gpsAverage: "一般",
    gpsPoor: "差",
    signalLost: "无信号",
    signalWifi: "Wi-Fi",
    signalCellular: "蜂窝网络",
    signalConnected: "已连接",
    speedUnit: "公里/小时",
    compass: "指南针",
    myMarkers: "我的标记",
    emptyMarkers: "暂无标记",
    addFirst: "+ 添加第一个标记",
    exportGeoJSON: "导出GeoJSON",
    importGeoJSON: "导入GeoJSON",
    addMarker: "添加新标记",
    markerName: "标记名称（必填）",
    markerNote: "备注（可选）",
    markerPhoto: "标记照片（可选）",
    takePhoto: "拍照",
    saveMarker: "保存当前位置",
    acquiringGPS: "精确定位中...",
    gpsReady: "GPS就绪",
    retry: "重试",
    utc: "协调世界时",
    localTime: "当地时间",
    sun: "太阳",
    sunrise: "日出",
    sunset: "日落",
    gpsImproved: "GPS已优化",
    accuracy: "当前精度",
    arrived: "已到达！",
    arrivedMessage: "您位于标记附近",
    chooseAnother: "选择其他",
    close: "关闭",
    ok: "确定",
    cancel: "取消",
    deleteConfirm: "确定要删除吗？",
    delete: "删除",
    networkRestored: "网络已恢复！",
    networkRestoredMsg: "您靠近有人区域。\n环顾四周寻求帮助。",
    gpsCalibrated: "GPS已优化",
    gpsCalibratedMsg: "当前精度：±",
    meter: "米",
    sample: "个样本",
    holdSteady: "保持设备静止以获得最佳结果",
    language: "语言",
    selectLanguage: "选择语言",
    vietnamese: "越南语",
    english: "英语",
    chinese: "中文",
    french: "法语",
    spanish: "西班牙语",
    korean: "韩语",
    exportSuccess: "导出成功",
    importSuccess: "导入成功",
    importing: "导入中...",
    exporting: "导出中...",
    gpsNotAvailable: "GPS不可用",
    permissionRequired: "需要位置权限",
    gpsError: "GPS错误",
    cameraPermission: "需要相机权限",
    saveImageError: "保存图片错误",
    addSuccess: "标记已保存！",
    addSuccessMsg: "精度：±",
    addedMarkers: "已添加",
    markers: "个标记",
    invalidGeoJSON: "GeoJSON格式错误",
    shareNotAvailable: "无法分享",
    gpsFallback: "无法获取GPS，使用旧位置",
    preparingGPS: "正在稳定GPS位置...",
    meterShort: "米",
    kmShort: "公里",
    offCourse: "偏离方向",
    waypointDeleted: "标记已删除",
    gpsWaiting: "正在获取位置...",
    gpsDetails: "GPS详情",
    networkDetails: "网络详情",
    rawLatitude: "原始纬度",
    rawLongitude: "原始经度",
    filtered: "滤波后",
    satellites: "卫星数",
    provider: "提供者",
    networkType: "网络类型",
    signalStrength: "信号强度",
    carrier: "运营商",
    ipAddress: "IP地址",
    mapLayer: "地图层",
    layerSatellite: "卫星",
    layerStreet: "街道",
    layerNone: "无",
    offlineTiles: "离线",
    downloadArea: "下载标记周围区域",
    downloadingTiles: "正在下载切片",
    tilesReady: "离线地图就绪",
    tilesDownloaded: "切片已下载",
    tileDownloadFail: "切片下载错误",
    offlineBadge: "离线",
    mapAttribution: "来源：Esri, Maxar, Earthstar Geographics, GIS User Community",
  },
  en: {
    appName: "AntiLost Navigator",
    tabNav: "Navigate",
    tabList: "Markers",
    tabTime: "Time",
    tab2D: "2D",
    noTarget: "No target selected",
    selectTargetHint: "Go to 'Markers' tab to select a target",
    headingTo: "Heading to",
    turnRight: "Turn RIGHT",
    turnLeft: "Turn LEFT",
    correctHeading: "On correct heading",
    distance: "distance",
    bearingError: "off course",
    cancelNav: "Cancel navigation",
    deleteWaypoint: "Delete marker",
    disclaimer:
      "⚠️ Position error ±3-5m. Use visual observation and navigation skills.",
    gpsStable: "GPS stable",
    gpsSearching: "Searching GPS",
    gpsGood: "Good",
    gpsAverage: "Avg",
    gpsPoor: "Poor",
    signalLost: "No signal",
    signalWifi: "Wi-Fi",
    signalCellular: "Cellular",
    signalConnected: "Connected",
    speedUnit: "km/h",
    compass: "Compass",
    myMarkers: "My markers",
    emptyMarkers: "No markers saved",
    addFirst: "+ Add first marker",
    exportGeoJSON: "Export GeoJSON",
    importGeoJSON: "Import GeoJSON",
    addMarker: "Add new marker",
    markerName: "Marker name (Required)",
    markerNote: "Note (Optional)",
    markerPhoto: "Marker photo (Optional)",
    takePhoto: "Take photo",
    saveMarker: "Save current location",
    acquiringGPS: "Accurate positioning...",
    gpsReady: "GPS ready",
    retry: "Retry",
    utc: "UTC",
    localTime: "Local time",
    sun: "Sun",
    sunrise: "Sunrise",
    sunset: "Sunset",
    gpsImproved: "GPS improved",
    accuracy: "Current accuracy",
    arrived: "Arrived!",
    arrivedMessage: "You are near marker",
    chooseAnother: "Choose another",
    close: "Close",
    ok: "OK",
    cancel: "Cancel",
    deleteConfirm: "Are you sure you want to delete?",
    delete: "Delete",
    networkRestored: "Network restored!",
    networkRestoredMsg:
      "You are near populated area.\nLook around for help.",
    gpsCalibrated: "GPS improved",
    gpsCalibratedMsg: "Current accuracy: ±",
    meter: "m",
    sample: "samples",
    holdSteady: "Keep device still for best results",
    language: "Language",
    selectLanguage: "Select language",
    vietnamese: "Vietnamese",
    english: "English",
    chinese: "Chinese",
    french: "French",
    spanish: "Spanish",
    korean: "Korean",
    exportSuccess: "Export successful",
    importSuccess: "Import successful",
    importing: "Importing...",
    exporting: "Exporting...",
    gpsNotAvailable: "GPS not available",
    permissionRequired: "Location permission required",
    gpsError: "GPS error",
    cameraPermission: "Camera permission required",
    saveImageError: "Save image error",
    addSuccess: "Marker saved!",
    addSuccessMsg: "Accuracy: ±",
    addedMarkers: "Added",
    markers: "markers",
    invalidGeoJSON: "Invalid GeoJSON",
    shareNotAvailable: "Sharing not available",
    gpsFallback: "Cannot get GPS, using old location",
    preparingGPS: "Stabilizing GPS position...",
    meterShort: "m",
    kmShort: "km",
    offCourse: "off course",
    waypointDeleted: "Marker deleted",
    gpsWaiting: "Getting location...",
    gpsDetails: "GPS Details",
    networkDetails: "Network Details",
    rawLatitude: "Raw latitude",
    rawLongitude: "Raw longitude",
    filtered: "Filtered",
    satellites: "Satellites",
    provider: "Provider",
    networkType: "Network type",
    signalStrength: "Signal strength",
    carrier: "Carrier",
    ipAddress: "IP address",
    mapLayer: "Map layer",
    layerSatellite: "Satellite",
    layerStreet: "Street",
    layerNone: "None",
    offlineTiles: "Offline",
    downloadArea: "Download area around markers",
    downloadingTiles: "Downloading tiles",
    tilesReady: "Offline map ready",
    tilesDownloaded: "tiles downloaded",
    tileDownloadFail: "Tile download error",
    offlineBadge: "OFFLINE",
    mapAttribution: "Sources: Esri, Maxar, Earthstar Geographics, GIS User Community",
  },
  fr: {
    appName: "AntiLost Navigator",
    tabNav: "Naviguer",
    tabList: "Points",
    tabTime: "Heure",
    tab2D: "2D",
    noTarget: "Aucune cible",
    selectTargetHint: "Allez à l'onglet 'Points' pour sélectionner",
    headingTo: "Direction",
    turnRight: "Tourner à DROITE",
    turnLeft: "Tourner à GAUCHE",
    correctHeading: "Bonne direction",
    distance: "distance",
    bearingError: "écart",
    cancelNav: "Annuler",
    deleteWaypoint: "Supprimer",
    disclaimer:
      "⚠️ Erreur de position ±3-5m. Observez et utilisez vos compétences.",
    gpsStable: "GPS stable",
    gpsSearching: "Recherche GPS",
    gpsGood: "Bon",
    gpsAverage: "Moyen",
    gpsPoor: "Mauvais",
    signalLost: "Pas de signal",
    signalWifi: "Wi-Fi",
    signalCellular: "Réseau",
    signalConnected: "Connecté",
    speedUnit: "km/h",
    compass: "Boussole",
    myMarkers: "Mes points",
    emptyMarkers: "Aucun point",
    addFirst: "+ Ajouter",
    exportGeoJSON: "Exporter GeoJSON",
    importGeoJSON: "Importer GeoJSON",
    addMarker: "Nouveau point",
    markerName: "Nom (obligatoire)",
    markerNote: "Note (optionnel)",
    markerPhoto: "Photo (optionnel)",
    takePhoto: "Prendre photo",
    saveMarker: "Enregistrer",
    acquiringGPS: "Positionnement précis...",
    gpsReady: "GPS prêt",
    retry: "Réessayer",
    utc: "UTC",
    localTime: "Heure locale",
    sun: "Soleil",
    sunrise: "Lever",
    sunset: "Coucher",
    gpsImproved: "GPS amélioré",
    accuracy: "Précision actuelle",
    arrived: "Arrivé !",
    arrivedMessage: "Vous êtes près du point",
    chooseAnother: "Choisir autre",
    close: "Fermer",
    ok: "OK",
    cancel: "Annuler",
    deleteConfirm: "Supprimer ?",
    delete: "Supprimer",
    networkRestored: "Réseau rétabli !",
    networkRestoredMsg: "Zone peuplée à proximité.\nCherchez de l'aide.",
    gpsCalibrated: "GPS amélioré",
    gpsCalibratedMsg: "Précision : ±",
    meter: "m",
    sample: "échantillons",
    holdSteady: "Tenez l'appareil immobile",
    language: "Langue",
    selectLanguage: "Choisir langue",
    vietnamese: "Vietnamien",
    english: "Anglais",
    chinese: "Chinois",
    french: "Français",
    spanish: "Espagnol",
    korean: "Coréen",
    exportSuccess: "Export réussi",
    importSuccess: "Import réussi",
    importing: "Importation...",
    exporting: "Exportation...",
    gpsNotAvailable: "GPS indisponible",
    permissionRequired: "Autorisation de localisation requise",
    gpsError: "Erreur GPS",
    cameraPermission: "Autorisation caméra requise",
    saveImageError: "Erreur de sauvegarde",
    addSuccess: "Point enregistré !",
    addSuccessMsg: "Précision : ±",
    addedMarkers: "Ajouté",
    markers: "points",
    invalidGeoJSON: "GeoJSON invalide",
    shareNotAvailable: "Partage non disponible",
    gpsFallback: "Impossible d'obtenir le GPS, utilisation ancienne position",
    preparingGPS: "Stabilisation de la position GPS...",
    meterShort: "m",
    kmShort: "km",
    offCourse: "hors cap",
    waypointDeleted: "Point supprimé",
    gpsWaiting: "Obtention de la position...",
    gpsDetails: "Détails GPS",
    networkDetails: "Détails réseau",
    rawLatitude: "Latitude brute",
    rawLongitude: "Longitude brute",
    filtered: "Filtré",
    satellites: "Satellites",
    provider: "Fournisseur",
    networkType: "Type de réseau",
    signalStrength: "Force du signal",
    carrier: "Opérateur",
    ipAddress: "Adresse IP",
    mapLayer: "Couche de carte",
    layerSatellite: "Satellite",
    layerStreet: "Rue",
    layerNone: "Aucune",
    offlineTiles: "Hors ligne",
    downloadArea: "Télécharger la zone autour des points",
    downloadingTiles: "Téléchargement des tuiles",
    tilesReady: "Carte hors ligne prête",
    tilesDownloaded: "tuiles téléchargées",
    tileDownloadFail: "Erreur de téléchargement des tuiles",
    offlineBadge: "HORS LIGNE",
    mapAttribution: "Sources : Esri, Maxar, Earthstar Geographics, GIS User Community",
  },
  es: {
    appName: "AntiLost Navigator",
    tabNav: "Navegar",
    tabList: "Marcadores",
    tabTime: "Hora",
    tab2D: "2D",
    noTarget: "Sin objetivo",
    selectTargetHint: "Vaya a la pestaña 'Marcadores'",
    headingTo: "Dirigiendo a",
    turnRight: "Girar a la DERECHA",
    turnLeft: "Girar a la IZQUIERDA",
    correctHeading: "Dirección correcta",
    distance: "distancia",
    bearingError: "desviación",
    cancelNav: "Cancelar",
    deleteWaypoint: "Eliminar",
    disclaimer: "⚠️ Error de posición ±3-5m. Use observación y habilidades.",
    gpsStable: "GPS estable",
    gpsSearching: "Buscando GPS",
    gpsGood: "Bueno",
    gpsAverage: "Medio",
    gpsPoor: "Malo",
    signalLost: "Sin señal",
    signalWifi: "Wi-Fi",
    signalCellular: "Celular",
    signalConnected: "Conectado",
    speedUnit: "km/h",
    compass: "Brújula",
    myMarkers: "Mis marcadores",
    emptyMarkers: "Sin marcadores",
    addFirst: "+ Primer marcador",
    exportGeoJSON: "Exportar GeoJSON",
    importGeoJSON: "Importar GeoJSON",
    addMarker: "Nuevo marcador",
    markerName: "Nombre (requerido)",
    markerNote: "Nota (opcional)",
    markerPhoto: "Foto (opcional)",
    takePhoto: "Tomar foto",
    saveMarker: "Guardar",
    acquiringGPS: "Posicionamiento preciso...",
    gpsReady: "GPS listo",
    retry: "Reintentar",
    utc: "UTC",
    localTime: "Hora local",
    sun: "Sol",
    sunrise: "Amanecer",
    sunset: "Atardecer",
    gpsImproved: "GPS mejorado",
    accuracy: "Precisión actual",
    arrived: "¡Llegado!",
    arrivedMessage: "Está cerca del marcador",
    chooseAnother: "Elegir otro",
    close: "Cerrar",
    ok: "OK",
    cancel: "Cancelar",
    deleteConfirm: "¿Eliminar?",
    delete: "Eliminar",
    networkRestored: "¡Red restablecida!",
    networkRestoredMsg: "Zona poblada cerca.\nBusque ayuda.",
    gpsCalibrated: "GPS mejorado",
    gpsCalibratedMsg: "Precisión actual: ±",
    meter: "m",
    sample: "muestras",
    holdSteady: "Mantenga el dispositivo quieto",
    language: "Idioma",
    selectLanguage: "Seleccionar idioma",
    vietnamese: "Vietnamita",
    english: "Inglés",
    chinese: "Chino",
    french: "Francés",
    spanish: "Español",
    korean: "Coreano",
    exportSuccess: "Exportación exitosa",
    importSuccess: "Importación exitosa",
    importing: "Importando...",
    exporting: "Exportando...",
    gpsNotAvailable: "GPS no disponible",
    permissionRequired: "Permiso de ubicación requerido",
    gpsError: "Error GPS",
    cameraPermission: "Permiso de cámara requerido",
    saveImageError: "Error al guardar imagen",
    addSuccess: "¡Marcador guardado!",
    addSuccessMsg: "Precisión: ±",
    addedMarkers: "Agregado",
    markers: "marcadores",
    invalidGeoJSON: "GeoJSON inválido",
    shareNotAvailable: "Compartir no disponible",
    gpsFallback: "No se pudo obtener GPS, usando ubicación anterior",
    preparingGPS: "Estabilizando posición GPS (±3m)...",
    meterShort: "m",
    kmShort: "km",
    offCourse: "fuera de rumbo",
    waypointDeleted: "Marcador eliminado",
    gpsWaiting: "Obteniendo ubicación...",
    gpsDetails: "Detalles GPS",
    networkDetails: "Detalles de red",
    rawLatitude: "Latitud cruda",
    rawLongitude: "Longitud cruda",
    filtered: "Filtrado",
    satellites: "Satélites",
    provider: "Proveedor",
    networkType: "Tipo de red",
    signalStrength: "Intensidad de señal",
    carrier: "Operador",
    ipAddress: "Dirección IP",
    mapLayer: "Capa del mapa",
    layerSatellite: "Satélite",
    layerStreet: "Calle",
    layerNone: "Ninguna",
    offlineTiles: "Sin conexión",
    downloadArea: "Descargar área alrededor de los puntos",
    downloadingTiles: "Descargando teselas",
    tilesReady: "Mapa sin conexión listo",
    tilesDownloaded: "teselas descargadas",
    tileDownloadFail: "Error al descargar teselas",
    offlineBadge: "SIN CONEXIÓN",
    mapAttribution: "Fuentes: Esri, Maxar, Earthstar Geographics, GIS User Community",
  },
  ko: {
    appName: "안티로스트 내비게이터",
    tabNav: "내비게이션",
    tabList: "마커",
    tabTime: "시간",
    tab2D: "2D 지도",
    noTarget: "목표 없음",
    selectTargetHint: "'마커' 탭에서 목표를 선택하세요",
    headingTo: "방향",
    turnRight: "오른쪽으로 돌기",
    turnLeft: "왼쪽으로 돌기",
    correctHeading: "올바른 방향",
    distance: "거리",
    bearingError: "방향 이탈",
    cancelNav: "내비게이션 취소",
    deleteWaypoint: "마커 삭제",
    disclaimer: "⚠️ 위치 오차 ±3-5m. 실제 관찰 및 방향 기술을 활용하세요.",
    gpsStable: "GPS 안정",
    gpsSearching: "GPS 검색 중",
    gpsGood: "좋음",
    gpsAverage: "보통",
    gpsPoor: "나쁨",
    signalLost: "신호 없음",
    signalWifi: "Wi-Fi",
    signalCellular: "셀룰러",
    signalConnected: "연결됨",
    speedUnit: "km/h",
    compass: "나침반",
    myMarkers: "내 마커",
    emptyMarkers: "저장된 마커 없음",
    addFirst: "+ 첫 마커 추가",
    exportGeoJSON: "GeoJSON 내보내기",
    importGeoJSON: "GeoJSON 가져오기",
    addMarker: "새 마커 추가",
    markerName: "마커 이름 (필수)",
    markerNote: "메모 (선택)",
    markerPhoto: "사진 (선택)",
    takePhoto: "사진 찍기",
    saveMarker: "현재 위치 저장",
    acquiringGPS: "정밀 위치 확인 중...",
    gpsReady: "GPS 준비됨",
    retry: "재시도",
    utc: "UTC",
    localTime: "현지 시간",
    sun: "태양",
    sunrise: "일출",
    sunset: "일몰",
    gpsImproved: "GPS 개선됨",
    accuracy: "현재 정확도",
    arrived: "도착!",
    arrivedMessage: "마커 근처에 있습니다",
    chooseAnother: "다른 마커 선택",
    close: "닫기",
    ok: "확인",
    cancel: "취소",
    deleteConfirm: "삭제하시겠습니까?",
    delete: "삭제",
    networkRestored: "네트워크 복구됨!",
    networkRestoredMsg: "사람이 있는 지역 근처입니다.\n주변을 살펴보세요.",
    gpsCalibrated: "GPS 개선됨",
    gpsCalibratedMsg: "현재 정확도: ±",
    meter: "m",
    sample: "샘플",
    holdSteady: "최상의 결과를 위해 기기를 고정하세요",
    language: "언어",
    selectLanguage: "언어 선택",
    vietnamese: "베트남어",
    english: "영어",
    chinese: "중국어",
    french: "프랑스어",
    spanish: "스페인어",
    korean: "한국어",
    exportSuccess: "내보내기 성공",
    importSuccess: "가져오기 성공",
    importing: "가져오는 중...",
    exporting: "내보내는 중...",
    gpsNotAvailable: "GPS 사용 불가",
    permissionRequired: "위치 권한 필요",
    gpsError: "GPS 오류",
    cameraPermission: "카메라 권한 필요",
    saveImageError: "이미지 저장 오류",
    addSuccess: "마커 저장됨!",
    addSuccessMsg: "정확도: ±",
    addedMarkers: "추가됨",
    markers: "개 마커",
    invalidGeoJSON: "잘못된 GeoJSON",
    shareNotAvailable: "공유 불가",
    gpsFallback: "GPS를 가져올 수 없음, 이전 위치 사용",
    preparingGPS: "GPS 위치 안정화 중 (±3m)...",
    meterShort: "m",
    kmShort: "km",
    offCourse: "코스 이탈",
    waypointDeleted: "마커 삭제됨",
    gpsWaiting: "위치 가져오는 중...",
    gpsDetails: "GPS 세부 정보",
    networkDetails: "네트워크 세부 정보",
    rawLatitude: "원시 위도",
    rawLongitude: "원시 경도",
    filtered: "필터링됨",
    satellites: "위성 수",
    provider: "제공자",
    networkType: "네트워크 유형",
    signalStrength: "신호 강도",
    carrier: "통신사",
    ipAddress: "IP 주소",
    mapLayer: "지도 레이어",
    layerSatellite: "위성",
    layerStreet: "거리",
    layerNone: "없음",
    offlineTiles: "오프라인",
    downloadArea: "지점 주변 영역 다운로드",
    downloadingTiles: "타일 다운로드 중",
    tilesReady: "오프라인 지도 준비 완료",
    tilesDownloaded: "타일 다운로드됨",
    tileDownloadFail: "타일 다운로드 오류",
    offlineBadge: "오프라인",
    mapAttribution: "출처: Esri, Maxar, Earthstar Geographics, GIS User Community",
  },
};

let currentLang = "vi";
const t = (key) =>
  translations[currentLang]?.[key] || translations.vi[key] || key;

// --------------------------- SOUND PLAYER ---------------------------
async function playBeep() {
  try {
    const { sound } = await Audio.Sound.createAsync(
      require("./assets/beep.mp3"),
    );
    await sound.playAsync();
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.didJustFinish) sound.unloadAsync();
    });
  } catch (error) {
    console.log("Beep error (maybe missing file):", error);
  }
}

// --------------------------- CUSTOM MAP 2D (nâng cấp) ---------------------------
function CustomMap2D({
  waypoints,
  currentLocation,
  trackPoints,
  onSelectWaypoint,
  onDeleteWaypoint,
}) {
  const [layoutSize, setLayoutSize] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState(null);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [scale, setScale] = useState(1);
  const [selectedWp, setSelectedWp] = useState(null);
  const [infoVisible, setInfoVisible] = useState(false);

  useEffect(() => {
    if (!layoutSize.width || !layoutSize.height) return;
    if (!waypoints.length && !currentLocation && !trackPoints.length) return;
    let minLat = 90,
      maxLat = -90,
      minLon = 180,
      maxLon = -180;
    if (currentLocation) {
      minLat = Math.min(minLat, currentLocation.latitude);
      maxLat = Math.max(maxLat, currentLocation.latitude);
      minLon = Math.min(minLon, currentLocation.longitude);
      maxLon = Math.max(maxLon, currentLocation.longitude);
    }
    waypoints.forEach((wp) => {
      minLat = Math.min(minLat, wp.lat);
      maxLat = Math.max(maxLat, wp.lat);
      minLon = Math.min(minLon, wp.lon);
      maxLon = Math.max(maxLon, wp.lon);
    });
    trackPoints.forEach((p) => {
      minLat = Math.min(minLat, p.latitude);
      maxLat = Math.max(maxLat, p.latitude);
      minLon = Math.min(minLon, p.longitude);
      maxLon = Math.max(maxLon, p.longitude);
    });
    const padding = 0.1;
    const latRange = maxLat - minLat || 0.02;
    const lonRange = maxLon - minLon || 0.02;
    setBounds({
      minLat: minLat - latRange * padding,
      maxLat: maxLat + latRange * padding,
      minLon: minLon - lonRange * padding,
      maxLon: maxLon + lonRange * padding,
    });
    setOffsetX(0);
    setOffsetY(0);
    setScale(1);
  }, [waypoints, currentLocation, trackPoints, layoutSize]);

  const latToY = (lat) => {
    if (!bounds) return 0;
    const y =
      ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) *
      layoutSize.height;
    return layoutSize.height - y;
  };
  const lonToX = (lon) => {
    if (!bounds) return 0;
    return (
      ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) *
      layoutSize.width
    );
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (e, gesture) => {
        setOffsetX((prev) => prev + gesture.dx);
        setOffsetY((prev) => prev + gesture.dy);
      },
    }),
  ).current;

  const [pinchStart, setPinchStart] = useState(null);
  const onTouchStart = (e) => {
    const touches = e.nativeEvent.touches;
    if (touches.length === 2) {
      const dx = touches[0].pageX - touches[1].pageX;
      const dy = touches[0].pageY - touches[1].pageY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      setPinchStart({ distance, scale });
    }
  };
  const onTouchMove = (e) => {
    if (pinchStart) {
      const touches = e.nativeEvent.touches;
      if (touches.length === 2) {
        const dx = touches[0].pageX - touches[1].pageX;
        const dy = touches[0].pageY - touches[1].pageY;
        const newDistance = Math.sqrt(dx * dx + dy * dy);
        const scaleChange = newDistance / pinchStart.distance;
        let newScale = pinchStart.scale * scaleChange;
        newScale = Math.min(Math.max(newScale, 0.5), 3);
        setScale(newScale);
      }
    }
  };
  const onTouchEnd = () => setPinchStart(null);

  const centerToCurrent = () => {
    if (!currentLocation || !bounds) return;
    const x = lonToX(currentLocation.longitude);
    const y = latToY(currentLocation.latitude);
    const centerX = layoutSize.width / 2;
    const centerY = layoutSize.height / 2;
    setOffsetX(centerX - x * scale);
    setOffsetY(centerY - y * scale);
  };
  const resetView = () => {
    setOffsetX(0);
    setOffsetY(0);
    setScale(1);
  };

  const handleWpPress = (wp) => {
    setSelectedWp(wp);
    setInfoVisible(true);
    if (onSelectWaypoint) onSelectWaypoint(wp);
  };

  const renderScaleBar = () => {
    if (!bounds || !layoutSize.width) return null;
    const mapWidthMeters = haversineDistance(
      { latitude: bounds.minLat, longitude: bounds.minLon },
      { latitude: bounds.minLat, longitude: bounds.maxLon },
    );
    const pixelsPerMeter = layoutSize.width / mapWidthMeters;
    const targetPx = 100;
    const distM = targetPx / pixelsPerMeter;
    let text, widthPx;
    if (distM >= 1000) {
      text = `${(distM / 1000).toFixed(1)} ${t("kmShort")}`;
      widthPx = (distM / 1000) * 1000 * pixelsPerMeter;
    } else {
      text = `${Math.round(distM)} ${t("meterShort")}`;
      widthPx = distM * pixelsPerMeter;
    }
    widthPx = Math.min(widthPx, layoutSize.width * 0.4);
    return (
      <View style={styles.scaleBarContainer}>
        <View style={[styles.scaleBar, { width: widthPx }]}>
          <View style={styles.scaleTickLeft} />
          <View style={styles.scaleTickRight} />
        </View>
        <Text style={styles.scaleText}>{text}</Text>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#F8F9FC" }}>
      <View
        style={{ flex: 1 }}
        onLayout={(e) =>
          setLayoutSize({
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height,
          })
        }
        {...panResponder.panHandlers}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {bounds && (
          <Svg width={layoutSize.width} height={layoutSize.height}>
            <Rect width="100%" height="100%" fill="#F8F9FC" />
            {[...Array(10)].map((_, i) => {
              const x = (i / 9) * layoutSize.width;
              return (
                <Line
                  key={`v-${i}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={layoutSize.height}
                  stroke="#E2E8F0"
                  strokeWidth={1}
                  strokeDasharray="4,4"
                />
              );
            })}
            {[...Array(10)].map((_, i) => {
              const y = (i / 9) * layoutSize.height;
              return (
                <Line
                  key={`h-${i}`}
                  x1={0}
                  y1={y}
                  x2={layoutSize.width}
                  y2={y}
                  stroke="#E2E8F0"
                  strokeWidth={1}
                  strokeDasharray="4,4"
                />
              );
            })}
            <G transform={`translate(${offsetX}, ${offsetY}) scale(${scale})`}>
              {trackPoints.length > 1 && (
                <Polyline
                  points={trackPoints
                    .map((p) => `${lonToX(p.longitude)},${latToY(p.latitude)}`)
                    .join(" ")}
                  fill="none"
                  stroke="#0A84FF"
                  strokeWidth={3}
                  strokeLinecap="round"
                  opacity={0.6}
                />
              )}
              {trackPoints.map((p, idx) => (
                <Circle
                  key={`track-${idx}`}
                  cx={lonToX(p.longitude)}
                  cy={latToY(p.latitude)}
                  r={3}
                  fill="#0A84FF"
                  opacity={0.5}
                />
              ))}
              {waypoints
                .sort((a, b) => a.id - b.id)
                .map((wp, i, arr) => {
                  if (i === arr.length - 1) return null;
                  const wp1 = wp,
                    wp2 = arr[i + 1];
                  return (
                    <Line
                      key={`conn-${wp1.id}`}
                      x1={lonToX(wp1.lon)}
                      y1={latToY(wp1.lat)}
                      x2={lonToX(wp2.lon)}
                      y2={latToY(wp2.lat)}
                      stroke="#FF3B30"
                      strokeWidth={2}
                      strokeDasharray="5,5"
                    />
                  );
                })}
              {waypoints.map((wp) => (
                <G key={wp.id} onPress={() => handleWpPress(wp)}>
                  <Circle
                    cx={lonToX(wp.lon)}
                    cy={latToY(wp.lat)}
                    r={12}
                    fill="#FFF"
                    stroke="#0A84FF"
                    strokeWidth={3}
                  />
                  <Circle
                    cx={lonToX(wp.lon)}
                    cy={latToY(wp.lat)}
                    r={6}
                    fill="#0A84FF"
                  />
                  <SvgText
                    x={lonToX(wp.lon) + 15}
                    y={latToY(wp.lat) - 8}
                    fontSize="12"
                    fill="#1E293B"
                    fontWeight="bold"
                  >
                    {wp.name}
                  </SvgText>
                  {wp.imageUri && (
                    <SvgImage
                      href={{ uri: wp.imageUri }}
                      x={lonToX(wp.lon) - 20}
                      y={latToY(wp.lat) - 35}
                      width={40}
                      height={40}
                      preserveAspectRatio="xMidYMid slice"
                    />
                  )}
                </G>
              ))}
              {currentLocation && (
                <G>
                  <Circle
                    cx={lonToX(currentLocation.longitude)}
                    cy={latToY(currentLocation.latitude)}
                    r={18}
                    fill="#34C759"
                    opacity={0.3}
                  />
                  <Circle
                    cx={lonToX(currentLocation.longitude)}
                    cy={latToY(currentLocation.latitude)}
                    r={12}
                    fill="#34C759"
                    stroke="#FFF"
                    strokeWidth={3}
                  />
                  <Circle
                    cx={lonToX(currentLocation.longitude)}
                    cy={latToY(currentLocation.latitude)}
                    r={5}
                    fill="#FFF"
                  />
                </G>
              )}
            </G>
          </Svg>
        )}
      </View>
      <TouchableOpacity style={styles.centerButton} onPress={centerToCurrent}>
        <Feather name="target" size={24} color="#FFF" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.resetButton} onPress={resetView}>
        <Feather name="refresh-cw" size={20} color="#FFF" />
      </TouchableOpacity>
      {renderScaleBar()}
      <Modal visible={infoVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.infoCard}>
            <View style={styles.infoHeader}>
              <Text style={styles.infoTitle}>{selectedWp?.name}</Text>
              <TouchableOpacity onPress={() => setInfoVisible(false)}>
                <Feather name="x" size={24} color="#1E293B" />
              </TouchableOpacity>
            </View>
            {selectedWp?.imageUri && (
              <Image
                source={{ uri: selectedWp.imageUri }}
                style={styles.infoImage}
              />
            )}
            <Text style={styles.infoNote}>
              {selectedWp?.note || t("markerNote")}
            </Text>
            <Text style={styles.infoCoord}>
              🗺️ {selectedWp?.lat.toFixed(6)}, {selectedWp?.lon.toFixed(6)}
            </Text>
            <Text style={styles.infoDate}>
              📅 {new Date(selectedWp?.timestamp).toLocaleString()}
            </Text>
            <View style={styles.infoActions}>
              <TouchableOpacity
                style={styles.infoButton}
                onPress={() => {
                  setInfoVisible(false);
                  if (onSelectWaypoint) onSelectWaypoint(selectedWp);
                }}
              >
                <Text style={styles.infoButtonText}>{t("tabNav")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.infoButton, styles.infoButtonDelete]}
                onPress={() => {
                  if (onDeleteWaypoint && selectedWp)
                    onDeleteWaypoint(selectedWp.id);
                  setInfoVisible(false);
                }}
              >
                <Text style={[styles.infoButtonText, { color: "#FF3B30" }]}>
                  {t("delete")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// --------------------------- MAIN APP ---------------------------

// --------------------------- TILE MAP (VỆ TINH OFFLINE) ---------------------------
// v1.1.2: bản đồ nền dạng tile XYZ (ESRI World Imagery miễn phí), lưu cache
// cục bộ để xem offline hoàn toàn. Kèm chức năng "tải khu vực offline".
// v1.1.3: tile đóng gói sẵn trong app (offline bundle Việt Nam)
// Cấu trúc: assets/tiles/<layer>/<z>/<x>/<y>.{jpg|png}

// v1.1.4: bundle tile Việt Nam — map static require được gen tự động bởi
// gen_bundle_index.py (Metro cần chuỗi literal trong require())
// Cấu trúc: { satellite: {z: {x: {y: asset}}}, street: {...} }
const BUNDLED_TILE_MAP = (() => {
  try {
    return require("./assets/tiles/bundleIndex.js");
  } catch (e) {
    return null;
  }
})();
const getBundledTileUri = (layer, z, x, y) => {
  try {
    if (z < 4 || z > 10 || !BUNDLED_TILE_MAP) return null;
    const asset = BUNDLED_TILE_MAP?.[layer]?.[z]?.[x]?.[y];
    // React Native thường trả về số asset ID từ require() (không phải object).
    // Chấp nhận mọi dạng hợp lệ để Image.resolveAssetSource() xử lý.
    if (asset !== null && asset !== undefined && asset !== false) return asset;
  } catch (e) {}
  return null;
};
const TILE_SERVERS = {
  satellite: {
    urlTemplate: "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    tileSize: 256,
    minZoom: 2,
    maxZoom: 18,
  },
  street: {
    urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileSize: 256,
    minZoom: 2,
    maxZoom: 18,
  },
};

// Chuyển lat/lon -> tile coords theo Web Mercator (chuẩn ESRI/OSM)
const latLonToTile = (lat, lon, zoom) => {
  const n = Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x: Math.floor(x), y: Math.floor(y) };
};

// Tile bounds (lat/lon) của một tile cụ thể
const tileBounds = (x, y, z) => {
  const n = Math.pow(2, z);
  const lon1 = (x / n) * 360 - 180;
  const lon2 = ((x + 1) / n) * 360 - 180;
  const lat2 = toDeg(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))));
  const lat1 = toDeg(Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))));
  return { minLon: lon1, maxLon: lon2, minLat: lat2, maxLat: lat1 };
};

const tilesCacheDir = () =>
  `${FileSystem.documentDirectory}tiles/`;

const tileLocalPath = (layer, z, x, y) =>
  `${tilesCacheDir()}${layer}/${z}/${x}/${y}.png`;

// Đảm bảo thư mục cache tồn tại
const ensureTileDir = async (layer, z, x) => {
  const dir = `${tilesCacheDir()}${layer}/${z}/${x}`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
};

// Đếm tile đã cache trong một vùng (để check offline sẵn sàng)
const countCachedTiles = async (layer, minZ, maxZ) => {
  try {
    const dirInfo = await FileSystem.getInfoAsync(`${tilesCacheDir()}${layer}`);
    if (!dirInfo.exists) return 0;
    const res = await FileSystem.readDirectoryAsync(`${tilesCacheDir()}${layer}`);
    let total = 0;
    for (const z of res) {
      const zn = parseInt(z, 10);
      if (zn < minZ || zn > maxZ) continue;
      const zInfo = await FileSystem.readDirectoryAsync(`${tilesCacheDir()}${layer}/${z}`);
      for (const x of zInfo) {
        const xInfo = await FileSystem.readDirectoryAsync(`${tilesCacheDir()}${layer}/${z}/${x}`);
        total += xInfo.length;
      }
    }
    return total;
  } catch (e) {
    return 0;
  }
};

// Xóa cache tile
const clearTileCache = async (layer) => {
  try {
    const dir = `${tilesCacheDir()}${layer}`;
    const info = await FileSystem.getInfoAsync(dir);
    if (info.exists) await FileSystem.deleteAsync(dir, { idempotent: true });
  } catch (e) {}
};

// Tải 1 tile và lưu local; trả uri local nếu có cache, null nếu lỗi
  const loadTileAsync = async (layer, z, x, y) => {
  // v1.1.3: ưu tiên tile đóng gói sẵn trong app (offline bundle)
  const bundled = getBundledTileUri(layer, z, x, y);
  if (bundled) {
    // Tile đóng gói sẵn: trả trực tiếp asset (chỉ hỗ trợ zoom 4-10)
    return { __bundled: true, asset: bundled };
  }
  const uri = tileLocalPath(layer, z, x, y);
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && info.size > 0) {
      return uri.startsWith("file://") ? uri : `file://${uri}`;
    }
    await ensureTileDir(layer, z, x);
    const server = TILE_SERVERS[layer];
    const url = server.urlTemplate
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
    const dl = FileSystem.createDownloadResumable(
      url,
      uri,
      { headers: { "User-Agent": "AntiLostNavigator/1.1.3 (+com.antilost.navigator)" } },
      undefined,
      30000,
    );
    const res = await dl.downloadAsync();
    if (res && res.bytesWritten > 0) {
      // Đảm bảo URI trả về có prefix file:// để SvgImage đọc được
      const localUri = res.uri || uri;
      return localUri.startsWith("file://") ? localUri : `file://${localUri}`;
    }
    // tải thất bại => xóa file lỗi
    try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch (e) {}
  } catch (e) {}
  return null;
};

// Tải toàn bộ tile phủ một khu vực tròn (center, radiusKm, minZ..maxZ)
const downloadAreaTiles = async (layer, center, radiusKm, minZ, maxZ, onProgress) => {
  const R_EARTH = 6371e3;
  const lat = center.latitude;
  // Công thức chuẩn: độ kinh độ = m / (R * cos(lat)) đổi radian
  const lonW2 = center.longitude - (radiusKm * 1000) / (R_EARTH * Math.cos(toRad(lat)));
  const lonE2 = center.longitude + (radiusKm * 1000) / (R_EARTH * Math.cos(toRad(lat)));
  const latS = center.latitude - toDeg(radiusKm * 1000 / R_EARTH);
  const latN = center.latitude + toDeg(radiusKm * 1000 / R_EARTH);
  const tiles = [];
  for (let z = minZ; z <= maxZ; z++) {
    const nw = latLonToTile(latN, lonW2, z);
    const se = latLonToTile(latS, lonE2, z);
    for (let x = nw.x; x <= se.x; x++) {
      for (let y = nw.y; y <= se.y; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  let done = 0;
  for (const t of tiles) {
    await loadTileAsync(layer, t.z, t.x, t.y);
    done += 1;
    if (onProgress) onProgress(done, tiles.length);
    if (done % 5 === 0) await sleep(80); // tránh bị block rate từ server
  }
  return { done, total: tiles.length };
};

// --------------------------- MAIN APP ---------------------------
export default function App() {
  const { width, height } = useWindowDimensions();
  const compassSize = Math.min(Math.min(width, height) * 0.55, 320);
  const arrowIconSize = Math.round(compassSize * 0.56);
  const fs = (base) => Math.round(base * Math.min(width / 390, 1.15));
  const isSmall = height < 700;

  // Language
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [, forceUpdate] = useState({});
  useEffect(() => {
    (async () => {
      const savedLang = await AsyncStorage.getItem("app_language");
      if (savedLang && translations[savedLang]) currentLang = savedLang;
      else currentLang = "vi";
      forceUpdate({});
    })();
  }, []);

  const changeLanguage = async (lang) => {
    currentLang = lang;
    await AsyncStorage.setItem("app_language", lang);
    forceUpdate({});
    setLangModalVisible(false);
  };

  // States
  const [location, setLocation] = useState(null);
  const [rawLocation, setRawLocation] = useState(null); // Raw GPS before Kalman
  const [gpsTimestamp, setGpsTimestamp] = useState(null);
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [heading, setHeading] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [waypoints, setWaypoints] = useState([]);
  const [target, setTarget] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [activeTab, setActiveTab] = useState("list");
  const [isAddModalVisible, setAddModalVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newImageUri, setNewImageUri] = useState(null);
  const [isAcquiringPos, setIsAcquiringPos] = useState(false);
  const [acquisitionProgress, setAcquisitionProgress] = useState(0);
  const [headingSource, setHeadingSource] = useState("none");
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [utcDate, setUtcDate] = useState("");
  const [utcTime, setUtcTime] = useState("");
  const [localDate, setLocalDate] = useState("");
  const [localTime, setLocalTime] = useState("");
  const [sunrise, setSunrise] = useState("");
  const [sunset, setSunset] = useState("");
  const [isLoadingSun, setIsLoadingSun] = useState(false);
  const isAlerting = useRef(false);
  const locationWatcher = useRef(null);
  const kalmanLat = useRef(new KalmanFilter1D());
  const kalmanLon = useRef(new KalmanFilter1D());
  const lastAcceptedPos = useRef(null);
  const lastAcceptedTime = useRef(null);
  const lastSpeedCalcPos = useRef(null);
  const lastSpeedCalcTime = useRef(null);
  const headingWatcher = useRef(null);
  const magnetometerListener = useRef(null);
  const deviceMotionListener = useRef(null);
  const gravityRef = useRef(null);
  const headingSourceRef = useRef("none");
  const ewmaVecRef = useRef({ x: null, y: null });
  const [signalInfo, setSignalInfo] = useState({
    type: null,
    connected: false,
    details: null,
  });
  const prevConnectedRef = useRef(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(null);
  const [hasMediaPermission, setHasMediaPermission] = useState(null);
  const [customAlertVisible, setCustomAlertVisible] = useState(false);
  const [customAlertData, setCustomAlertData] = useState({
    title: "",
    message: "",
    icon: { name: "star", color: "#FFD60A", lib: "Feather", bg: "#FFFBEB" },
    confirmText: "OK",
    onConfirm: () => {},
    cancelText: null,
    onCancel: () => {},
  });
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [selectedImageUri, setSelectedImageUri] = useState(null);
  const [isInitializingNav, setIsInitializingNav] = useState(false);
  const stationaryCheckTimer = useRef(null);
  const lastSpeedSamples = useRef([]);
  const [trackPoints, setTrackPoints] = useState([]);
  const [isTracking, setIsTracking] = useState(false);

  // New modals for GPS and network details
  const [gpsDetailsModalVisible, setGpsDetailsModalVisible] = useState(false);
  const [gpsProviderStatus, setGpsProviderStatus] = useState(null);
  const [networkDetailsModalVisible, setNetworkDetailsModalVisible] =
    useState(false);
  const [networkExtraDetails, setNetworkExtraDetails] = useState(null);

  // Time update
  useEffect(() => {
    const updateTimes = () => {
      const now = new Date();
      setUtcDate(now.toUTCString().split(" ").slice(0, 4).join(" "));
      setUtcTime(now.toUTCString().split(" ")[4]);
      setLocalDate(now.toLocaleDateString());
      setLocalTime(now.toLocaleTimeString());
    };
    updateTimes();
    const interval = setInterval(updateTimes, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (location?.latitude && location?.longitude)
      fetchSunriseSunset(location.latitude, location.longitude);
  }, [location]);

  const fetchSunriseSunset = async (lat, lon) => {
    setIsLoadingSun(true);
    try {
      const res = await fetch(
        `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&formatted=0`,
      );
      const data = await res.json();
      if (data.status === "OK") {
        setSunrise(new Date(data.results.sunrise).toLocaleTimeString());
        setSunset(new Date(data.results.sunset).toLocaleTimeString());
      } else {
        setSunrise("--:--");
        setSunset("--:--");
      }
    } catch {
      setSunrise("Lỗi");
      setSunset("Lỗi");
    } finally {
      setIsLoadingSun(false);
    }
  };

  // DB init
  useEffect(() => {
    initDBAndLoadData();
    startHeadingSystem();
    requestCameraPermission();
    requestMediaLibraryPermission();
    return () => {
      stopLocationWatcher();
      stopHeadingSystem();
      if (stationaryCheckTimer.current)
        clearTimeout(stationaryCheckTimer.current);
    };
  }, []);

  // Auto improve GPS when stationary
  useEffect(() => {
    if (!location || !gpsAccuracy) return;
    lastSpeedSamples.current.push({ speed, timestamp: Date.now() });
    if (lastSpeedSamples.current.length > 5) lastSpeedSamples.current.shift();
    const isStationary =
      lastSpeedSamples.current.every((s) => s.speed < 0.5) &&
      lastSpeedSamples.current.length >= 3;
    if (isStationary && gpsAccuracy > 8) {
      if (stationaryCheckTimer.current)
        clearTimeout(stationaryCheckTimer.current);
      stationaryCheckTimer.current = setTimeout(async () => {
        const stillStationary = lastSpeedSamples.current.every(
          (s) => s.speed < 0.5,
        );
        if (stillStationary && gpsAccuracy > 8) {
          try {
            const betterPos = await acquireAveragedPosition();
            if (betterPos.accuracy < gpsAccuracy) {
              setLocation((prev) => ({
                ...prev,
                latitude: betterPos.latitude,
                longitude: betterPos.longitude,
              }));
              setGpsAccuracy(betterPos.accuracy);
              kalmanLat.current.reset();
              kalmanLon.current.reset();
              kalmanLat.current.init(betterPos.latitude, Date.now());
              kalmanLon.current.init(betterPos.longitude, Date.now());
              lastAcceptedPos.current = {
                latitude: betterPos.latitude,
                longitude: betterPos.longitude,
              };
              lastAcceptedTime.current = Date.now();
              playBeep();
              showCustomAlert({
                title: t("gpsImproved"),
                message: `${t("accuracy")}: ±${betterPos.accuracy.toFixed(0)}${t("meter")}`,
                icon: {
                  name: "check-circle",
                  color: "#34C759",
                  lib: "Feather",
                  bg: "#E8FAF0",
                },
                confirmText: t("ok"),
                onConfirm: () => {},
                beep: false,
              });
            }
          } catch (e) {}
        }
        stationaryCheckTimer.current = null;
      }, 3000);
    } else if (!isStationary && stationaryCheckTimer.current) {
      clearTimeout(stationaryCheckTimer.current);
      stationaryCheckTimer.current = null;
    }
  }, [speed, gpsAccuracy]);

  // Tracking for map2D
  useEffect(() => {
    if (activeTab === "map2d") setIsTracking(true);
    else setIsTracking(false);
  }, [activeTab]);

  useEffect(() => {
    if (!isTracking || !location) return;
    const interval = setInterval(() => {
      setTrackPoints((prev) => {
        const last = prev[prev.length - 1];
        if (!last || haversineDistance(last, location) > 5) {
          return [
            ...prev,
            {
              latitude: location.latitude,
              longitude: location.longitude,
              timestamp: Date.now(),
            },
          ];
        }
        return prev;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [isTracking, location]);

  // Navigation initialization
  useEffect(() => {
    if (activeTab === "nav" && target) {
      prepareNavigation();
    } else {
      stopLocationWatcher();
    }
  }, [activeTab, target]);

  useEffect(() => {
    if (isAddModalVisible && !location) getCurrentLocationOnce();
  }, [isAddModalVisible]);

  // Network listener
  useEffect(() => {
    const sub = NetInfo.addEventListener((state) => {
      const conn = state.isConnected && state.type !== "none";
      setSignalInfo({
        type: state.type,
        connected: conn,
        details: state.details,
      });
      if (conn && !prevConnectedRef.current) {
        playBeep();
        showCustomAlert({
          title: t("networkRestored"),
          message: t("networkRestoredMsg"),
          icon: {
            name: "radio",
            color: "#0A84FF",
            lib: "Feather",
            bg: "#E5F0FF",
          },
          confirmText: t("ok"),
          cancelText: t("close"),
          onConfirm: () => {},
          onCancel: () => {},
          beep: false,
        });
      }
      prevConnectedRef.current = conn;
    });
    return () => sub();
  }, []);

  // Arrival alert
  useEffect(() => {
    if (location && target && !isAlerting.current && activeTab === "nav") {
      const dist = haversineDistance(location, {
        latitude: target.lat,
        longitude: target.lon,
      });
      if (dist <= 3) {
        isAlerting.current = true;
        playBeep();
        showCustomAlert({
          title: t("arrived"),
          message: `${t("arrivedMessage")} "${target.name}".`,
          icon: {
            name: "star",
            color: "#FFD60A",
            lib: "Feather",
            bg: "#FFFBEB",
          },
          confirmText: t("chooseAnother"),
          cancelText: t("close"),
          onConfirm: () => {
            setTarget(null);
            setActiveTab("list");
            isAlerting.current = false;
          },
          onCancel: () => {
            isAlerting.current = false;
          },
          beep: false,
        });
      }
    }
  }, [location, target, activeTab]);

  const requestCameraPermission = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    setHasCameraPermission(status === "granted");
  };
  const requestMediaLibraryPermission = async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    setHasMediaPermission(status === "granted");
  };

  const getCurrentLocationOnce = async () => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      showCustomAlert({
        title: t("permissionRequired"),
        message: t("permissionRequired"),
        icon: {
          name: "map-pin",
          color: "#FF3B30",
          lib: "Feather",
          bg: "#FFF0F0",
        },
        confirmText: t("ok"),
        onConfirm: () => {},
      });
      return;
    }
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      setLocation(loc.coords);
      setGpsTimestamp(loc.timestamp);
      if (loc.coords.accuracy) setGpsAccuracy(loc.coords.accuracy);
    } catch {
      showCustomAlert({
        title: t("gpsError"),
        message: t("gpsError"),
        icon: {
          name: "x-circle",
          color: "#FF3B30",
          lib: "Feather",
          bg: "#FFF0F0",
        },
        confirmText: t("retry"),
        cancelText: t("close"),
        onConfirm: () => getCurrentLocationOnce(),
        onCancel: () => {},
      });
    }
  };

  // GPS acquisition: mở MỘT watcher liên tục, giữ mẫu tốt nhất và tự tắt.
  // Không gọi getCurrentPositionAsync lặp lại vì Android có thể bật/tắt GPS
  // provider giữa các lần gọi, làm accuracy dao động và tốn pin.
  const acquireAveragedPosition = (onProgress) =>
    new Promise(async (resolve, reject) => {
      let subscription = null;
      let settled = false;
      let best = null;
      let stableCount = 0;
      let previous = null;
      const startedAt = Date.now();
      const maxWaitMs = 45000;
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        if (subscription) subscription.remove();
        if (err) reject(err);
        else resolve(value);
      };
      const timer = setInterval(() => {
        if (Date.now() - startedAt >= maxWaitMs) {
          clearInterval(timer);
          if (best) finish(null, { ...best, numSamples: stableCount });
          else finish(new Error("No GPS samples"));
        }
      }, 500);
      try {
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Highest,
            distanceInterval: 0,
            timeInterval: 800,
            mayShowUserSettingsDialog: true,
          },
          (loc) => {
            const c = loc.coords || {};
            const acc = Number.isFinite(c.accuracy) ? c.accuracy : 99;
            if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) || acc > 100) return;
            const candidate = {
              latitude: c.latitude,
              longitude: c.longitude,
              accuracy: acc,
              altitude: c.altitude,
              heading: c.heading,
              speed: c.speed,
            };
            stableCount += 1;
            if (!best || acc < best.accuracy) best = candidate;
            const quality = Math.min(100, Math.max(0, Math.round((1 - best.accuracy / 50) * 100)));
            onProgress?.(quality);
            if (previous) {
              const moved = haversineDistance(previous, candidate);
              if (moved <= Math.max(1.5, acc * 0.25)) stableCount += 1;
              else stableCount = 0;
            }
            previous = candidate;
            // Chờ accuracy tốt và vị trí ổn định; nếu GPS đã tốt thì dừng sớm.
            if (best.accuracy <= 5 && stableCount >= 3) {
              clearInterval(timer);
              onProgress?.(100);
              finish(null, { ...best, numSamples: stableCount });
            }
          },
        );
      } catch (e) {
        clearInterval(timer);
        finish(e);
      }
    });

  const showCustomAlert = ({
    title,
    message,
    icon,
    confirmText,
    cancelText,
    onConfirm,
    onCancel,
    beep = false,
  }) => {
    if (beep) playBeep();
    setCustomAlertData({
      title,
      message,
      icon,
      confirmText,
      cancelText: cancelText || null,
      onConfirm: () => {
        if (onConfirm) onConfirm();
        setCustomAlertVisible(false);
      },
      onCancel: () => {
        if (onCancel) onCancel();
        setCustomAlertVisible(false);
      },
    });
    setCustomAlertVisible(true);
  };

  const openImageViewer = (uri) => {
    setSelectedImageUri(uri);
    setImageViewerVisible(true);
  };
  const saveImageToDevice = async () => {
    if (!selectedImageUri) return;
    if (!hasMediaPermission) {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      setHasMediaPermission(status === "granted");
      if (status !== "granted") {
        showCustomAlert({
          title: t("saveImageError"),
          message: t("saveImageError"),
          icon: {
            name: "image",
            color: "#FF9F0A",
            lib: "Feather",
            bg: "#FFF8E7",
          },
          confirmText: t("ok"),
          onConfirm: () => {},
        });
        return;
      }
    }
    try {
      await MediaLibrary.saveToLibraryAsync(selectedImageUri);
      showCustomAlert({
        title: t("exportSuccess"),
        message: t("exportSuccess"),
        icon: {
          name: "check-circle",
          color: "#34C759",
          lib: "Feather",
          bg: "#E8FAF0",
        },
        confirmText: t("ok"),
        onConfirm: () => {},
      });
    } catch {
      showCustomAlert({
        title: t("saveImageError"),
        message: t("saveImageError"),
        icon: {
          name: "x-circle",
          color: "#FF3B30",
          lib: "Feather",
          bg: "#FFF0F0",
        },
        confirmText: t("ok"),
        onConfirm: () => {},
      });
    }
  };

  const initDBAndLoadData = async () => {
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS markers ( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, note TEXT, lat REAL, lon REAL, timestamp INTEGER, type TEXT );`,
    );
    try {
      await db.execAsync(`ALTER TABLE markers ADD COLUMN imageUri TEXT;`);
    } catch (e) {}
    await loadWaypoints();
    setIsReady(true);
  };
  const loadWaypoints = async () => {
    const data = await db.getAllAsync(
      "SELECT * FROM markers ORDER BY timestamp DESC",
    );
    setWaypoints(data);
  };

  const exportToGeoJSON = async () => {
    setIsExporting(true);
    try {
      const features = waypoints.map((wp) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [wp.lon, wp.lat] },
        properties: {
          id: wp.id,
          name: wp.name,
          note: wp.note || "",
          timestamp: wp.timestamp,
          type: wp.type,
          imageUri: wp.imageUri || "",
        },
      }));
      const geojson = { type: "FeatureCollection", features };
      const fileUri =
        FileSystem.documentDirectory +
        `antilost_waypoints_${Date.now()}.geojson`;
      await FileSystem.writeAsStringAsync(
        fileUri,
        JSON.stringify(geojson, null, 2),
        { encoding: FileSystem.EncodingType.UTF8 },
      );
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(fileUri, {
          mimeType: "application/geo+json",
          dialogTitle: t("exportGeoJSON"),
        });
      else
        showCustomAlert({
          title: t("shareNotAvailable"),
          message: t("shareNotAvailable"),
          icon: {
            name: "alert-triangle",
            color: "#FF9F0A",
            lib: "Feather",
            bg: "#FFF8E7",
          },
          confirmText: t("ok"),
          onConfirm: () => {},
        });
    } catch (error) {
      showCustomAlert({
        title: t("exportSuccess"),
        message: error.message,
        icon: {
          name: "x-circle",
          color: "#FF3B30",
          lib: "Feather",
          bg: "#FFF0F0",
        },
        confirmText: t("ok"),
        onConfirm: () => {},
      });
    } finally {
      setIsExporting(false);
    }
  };
  const importFromGeoJSON = async () => {
    setIsImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/geo+json",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const geojson = JSON.parse(content);
      if (geojson.type !== "FeatureCollection")
        throw new Error(t("invalidGeoJSON"));
      let count = 0;
      for (const f of geojson.features) {
        if (f.geometry.type !== "Point") continue;
        const [lon, lat] = f.geometry.coordinates;
        const name = f.properties.name || `Imported ${Date.now()}_${count}`;
        await db.runAsync(
          "INSERT INTO markers (name, note, lat, lon, timestamp, type, imageUri) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            name,
            f.properties.note || "",
            lat,
            lon,
            Date.now(),
            f.properties.type || "flag",
            f.properties.imageUri || null,
          ],
        );
        count++;
      }
      await loadWaypoints();
      showCustomAlert({
        title: t("importSuccess"),
        message: `${t("addedMarkers")} ${count} ${t("markers")}`,
        icon: {
          name: "check-circle",
          color: "#34C759",
          lib: "Feather",
          bg: "#E8FAF0",
        },
        confirmText: t("ok"),
        onConfirm: () => {},
      });
    } catch (error) {
      showCustomAlert({
        title: t("importSuccess"),
        message: error.message,
        icon: {
          name: "x-circle",
          color: "#FF3B30",
          lib: "Feather",
          bg: "#FFF0F0",
        },
        confirmText: t("ok"),
        onConfirm: () => {},
      });
    } finally {
      setIsImporting(false);
    }
  };

  const startGPSWatcher = async () => {
    if (locationWatcher.current) return;
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      showCustomAlert({
        title: t("permissionRequired"),
        message: t("permissionRequired"),
        icon: {
          name: "map-pin",
          color: "#FF3B30",
          lib: "Feather",
          bg: "#FFF0F0",
        },
        confirmText: t("ok"),
        onConfirm: () => {},
      });
      return;
    }
    locationWatcher.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 0,
        timeInterval: 400,
        mayShowUserSettingsDialog: true,
      },
      (loc) => {
        const raw = loc.coords;
        const t = loc.timestamp;
        const acc = raw.accuracy ?? 20;
        if (acc > 80) return;
        // Save raw location for details modal
        setRawLocation({
          latitude: raw.latitude,
          longitude: raw.longitude,
          accuracy: raw.accuracy,
          timestamp: t,
        });
        if (lastAcceptedPos.current && lastAcceptedTime.current) {
          const dtMs = t - lastAcceptedTime.current;
          if (dtMs > 0 && dtMs < 8000) {
            const dist = haversineDistance(lastAcceptedPos.current, {
              latitude: raw.latitude,
              longitude: raw.longitude,
            });
            if (dist / (dtMs / 1000) > 28) return;
          }
        }
        const filtLat = kalmanLat.current.update(raw.latitude, acc, t);
        const filtLon = kalmanLon.current.update(raw.longitude, acc, t);
        lastAcceptedPos.current = { latitude: filtLat, longitude: filtLon };
        lastAcceptedTime.current = t;
        if (lastSpeedCalcPos.current && lastSpeedCalcTime.current) {
          const dtSec = (t - lastSpeedCalcTime.current) / 1000;
          if (dtSec > 0.5 && dtSec < 5) {
            const distMoved = haversineDistance(lastSpeedCalcPos.current, {
              latitude: filtLat,
              longitude: filtLon,
            });
            const spd = (distMoved / dtSec) * 3.6;
            if (spd >= 0 && spd < 200) setSpeed(Math.round(spd));
          }
        }
        lastSpeedCalcPos.current = { latitude: filtLat, longitude: filtLon };
        lastSpeedCalcTime.current = t;
        setLocation({ ...raw, latitude: filtLat, longitude: filtLon });
        setGpsTimestamp(t);
        setGpsAccuracy(acc);
      },
    );
  };
  const stopLocationWatcher = () => {
    if (locationWatcher.current) {
      locationWatcher.current.remove();
      locationWatcher.current = null;
    }
    setSpeed(0);
    lastSpeedCalcPos.current = null;
    lastSpeedCalcTime.current = null;
  };

  const prepareNavigation = async () => {
    if (!target) return;
    const currentPosAccurate =
      location &&
      gpsAccuracy &&
      gpsAccuracy <= 5 &&
      Date.now() - gpsTimestamp < 10000;
    if (currentPosAccurate && locationWatcher.current) return;
    setIsInitializingNav(true);
    try {
      stopLocationWatcher();
      const precisePos = await acquireAveragedPosition();
      setLocation({
        latitude: precisePos.latitude,
        longitude: precisePos.longitude,
        accuracy: precisePos.accuracy,
      });
      setGpsAccuracy(precisePos.accuracy);
      setGpsTimestamp(Date.now());
      kalmanLat.current.reset();
      kalmanLon.current.reset();
      kalmanLat.current.init(precisePos.latitude, Date.now());
      kalmanLon.current.init(precisePos.longitude, Date.now());
      lastAcceptedPos.current = {
        latitude: precisePos.latitude,
        longitude: precisePos.longitude,
      };
      lastAcceptedTime.current = Date.now();
      lastSpeedCalcPos.current = {
        latitude: precisePos.latitude,
        longitude: precisePos.longitude,
      };
      lastSpeedCalcTime.current = Date.now();
      await startGPSWatcher();
    } catch (err) {
      console.warn(err);
      await startGPSWatcher();
    } finally {
      setIsInitializingNav(false);
    }
  };

  // FIX v1.1.1: alpha 0.1 quá thấp làm heading phản hồi chậm khi xoay nhanh.
  const HEADING_ALPHA = 0.35;
  const applyHeadingEWMA = (rawDeg) => {
    const rad = (rawDeg * Math.PI) / 180;
    const cosA = Math.cos(rad),
      sinA = Math.sin(rad);
    const v = ewmaVecRef.current;
    if (v.x === null) {
      v.x = cosA;
      v.y = sinA;
    } else {
      v.x = v.x * (1 - HEADING_ALPHA) + cosA * HEADING_ALPHA;
      v.y = v.y * (1 - HEADING_ALPHA) + sinA * HEADING_ALPHA;
    }
    let smooth = (Math.atan2(v.y, v.x) * 180) / Math.PI;
    smooth = (smooth + 360) % 360;
    setHeading(smooth);
  };
  // ---- FIX v1.1.1: heading system ----
  // Vấn đề 1: Trên Android, Location.watchHeadingAsync thường không hoạt động,
  // app luôn rơi vào Magnetometer fallback. Góc Magnetometer trả về theo hệ
  // toạ độ ĐIỆN THOẠI (device frame), chưa phải hệ "Bắc = 0°" => lệch ~90°.
  // Vấn đề 2: magHeading là hướng TỪ TÍNH, chưa phải Bắc thật => phải trừ
  // magnetic declination (Location.getDeclinationAsync).
  const declinationRef = useRef(null); // độ, null = chưa lấy được
  const loadDeclination = async () => {
    try {
      const decl = await Location.getDeclinationAsync();
      declinationRef.current = typeof decl === "number" ? decl : null;
    } catch (e) {
      console.warn("Cannot load magnetic declination:", e);
    }
  };

  // Chuyển góc Magnetometer từ hệ toạ độ điện thoại sang hệ heading chuẩn
  // (0° = Bắc thật, tăng theo chiều kim đồng hồ).
  // expo-sensors trả theo HỆ PORTRAIT: X = bên phải màn hình, Y = phía trên
  // màn hình (đỉnh máy). Khi đỉnh máy chỉ hướng H (so với Bắc thật) và
  // declination = d, góc đo được bằng atan2(y,x) là: (90 - d + H) mod 360.
  // Đảo lại: H = (angle_atan2_deg + d - 90 + 360) % 360  (đã kiểm chứng bằng
  // mô phỏng hình học — file verify_rotation.py).
  // Hiệu chỉnh thực tế cho hệ trục Magnetometer trên Android khi máy ở tư thế
  // portrait/thẳng đứng. Không áp dụng offset cố định: tư thế máy thay đổi
  // phải được xử lý bằng cảm biến nghiêng, không thể sửa đúng bằng +45°.
  // Không áp dụng cho Location.watchHeadingAsync vì hệ điều hành đã hiệu chỉnh.
  const MAG_FALLBACK_OFFSET_DEG = 0;
  const magnetometerToHeading = (angleRad, mag) => {
    let deg = (angleRad * 180) / Math.PI;
    const g = gravityRef.current;
    // Tilt compensation: dùng vector trọng lực để loại ảnh hưởng pitch/roll.
    // Nếu chưa có gravity hợp lệ, dùng công thức portrait cũ làm fallback.
    if (g && mag && Math.hypot(g.x, g.y, g.z) > 4) {
      const pitch = Math.atan2(-g.x, Math.sqrt(g.y * g.y + g.z * g.z));
      const roll = Math.atan2(g.y, g.z);
      const mx = mag.x * Math.cos(pitch) + mag.z * Math.sin(pitch);
      const my =
        mag.x * Math.sin(roll) * Math.sin(pitch) +
        mag.y * Math.cos(roll) -
        mag.z * Math.sin(roll) * Math.cos(pitch);
      deg = (Math.atan2(my, mx) * 180) / Math.PI;
    }
    const d = declinationRef.current ?? 0;
    return (deg + d - 90 + MAG_FALLBACK_OFFSET_DEG + 360) % 360;
  };

  const startHeadingSystem = async () => {
    await loadDeclination();
    try {
      const sub = await Location.watchHeadingAsync((data) => {
        // trueHeading >= 0: Bắc THẬT (hệ điều hành đã trừ declination).
        // trueHeading = -1 (iOS khi chưa cấp Device Motion): dùng magHeading
        // rồi tự trừ declination.
        let raw = null;
        if (data.trueHeading >= 0) {
          raw = data.trueHeading;
        } else if (data.magHeading >= 0) {
          raw = applyDeclination(data.magHeading);
        }
        if (raw !== null) {
          applyHeadingEWMA(raw);
          if (headingSourceRef.current !== "location") {
            headingSourceRef.current = "location";
            setHeadingSource("location");
          }
        }
      });
      headingWatcher.current = sub;
    } catch (err) {
      startMagnetometerFallback();
    }
  };
  const startMagnetometerFallback = () => {
    DeviceMotion.setUpdateInterval(50);
    deviceMotionListener.current = DeviceMotion.addListener((data) => {
      const g = data.accelerationIncludingGravity || data.acceleration;
      if (g && Number.isFinite(g.x) && Number.isFinite(g.y) && Number.isFinite(g.z)) {
        gravityRef.current = g;
      }
    });
    Magnetometer.setUpdateInterval(80);
    magnetometerListener.current = Magnetometer.addListener((data) => {
      // Chuyển hệ tọa độ + tilt compensation + declination.
      const angleRad = Math.atan2(data.y, data.x);
      const trueDeg = magnetometerToHeading(angleRad, data);
      applyHeadingEWMA(trueDeg);
      if (headingSourceRef.current !== "magnetometer") {
        headingSourceRef.current = "magnetometer";
        setHeadingSource("magnetometer");
      }
    });
  };
  const stopHeadingSystem = () => {
    if (headingWatcher.current) headingWatcher.current.remove();
    if (magnetometerListener.current) Magnetometer.removeAllListeners();
    if (deviceMotionListener.current) {
      deviceMotionListener.current.remove();
      deviceMotionListener.current = null;
    }
    gravityRef.current = null;
    headingSourceRef.current = "none";
    setHeadingSource("none");
    ewmaVecRef.current = { x: null, y: null };
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    setHasCameraPermission(status === "granted");
    if (status !== "granted") {
      showCustomAlert({
        title: t("cameraPermission"),
        message: t("cameraPermission"),
        icon: {
          name: "camera",
          color: "#8E8E93",
          lib: "Feather",
          bg: "#F2F2F7",
        },
        confirmText: t("ok"),
        onConfirm: () => Linking.openSettings(),
        cancelText: t("cancel"),
        onCancel: () => {},
      });
      return;
    }
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.length)
        setNewImageUri(result.assets[0].uri);
    } catch (error) {
      showCustomAlert({
        title: t("cameraPermission"),
        message: error.message,
        icon: {
          name: "alert-triangle",
          color: "#FF9F0A",
          lib: "Feather",
          bg: "#FFF8E7",
        },
        confirmText: t("ok"),
        onConfirm: () => {},
      });
    }
  };
  const saveImageToAppFolder = async (tempUri) => {
    const filename = `${Date.now()}.jpg`;
    const newUri = FileSystem.documentDirectory + "images/" + filename;
    const dirInfo = await FileSystem.getInfoAsync(
      FileSystem.documentDirectory + "images/",
    );
    if (!dirInfo.exists)
      await FileSystem.makeDirectoryAsync(
        FileSystem.documentDirectory + "images/",
        { intermediates: true },
      );
    await FileSystem.copyAsync({ from: tempUri, to: newUri });
    return newUri;
  };
  const saveWaypoint = async () => {
    const finalName = newName.trim() || "Marker " + (waypoints.length + 1);
    const types = ["home", "flag", "tent", "mountain"];
    const type = types[waypoints.length % 4];
    let savedImageUri = null;
    if (newImageUri) {
      try {
        savedImageUri = await saveImageToAppFolder(newImageUri);
      } catch (e) {
        console.warn(e);
        showCustomAlert({
          title: t("saveImageError"),
          message: t("saveImageError"),
          icon: {
            name: "alert-triangle",
            color: "#FF9F0A",
            lib: "Feather",
            bg: "#FFF8E7",
          },
          confirmText: t("ok"),
          onConfirm: () => {},
        });
      }
    }
    setIsAcquiringPos(true);
    let bestPos;
    try {
      bestPos = await acquireAveragedPosition((p) => setAcquisitionProgress(p));
    } catch (err) {
      setIsAcquiringPos(false);
      setAcquisitionProgress(0);
      if (location)
        bestPos = {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: gpsAccuracy ?? 99,
          numSamples: 0,
        };
      else {
        showCustomAlert({
          title: t("gpsNotAvailable"),
          message: t("gpsNotAvailable"),
          icon: {
            name: "x-circle",
            color: "#FF3B30",
            lib: "Feather",
            bg: "#FFF0F0",
          },
          confirmText: t("retry"),
          cancelText: t("close"),
          onConfirm: saveWaypoint,
          onCancel: () => {},
        });
        return;
      }
    }
    setIsAcquiringPos(false);
    setLocation((prev) => ({
      ...prev,
      latitude: bestPos.latitude,
      longitude: bestPos.longitude,
    }));
    try {
      await db.runAsync(
        "INSERT INTO markers (name, note, lat, lon, timestamp, type, imageUri) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          finalName,
          newNote,
          bestPos.latitude,
          bestPos.longitude,
          Date.now(),
          type,
          savedImageUri,
        ],
      );
      setNewName("");
      setNewNote("");
      setNewImageUri(null);
      setAddModalVisible(false);
      await loadWaypoints();
      showCustomAlert({
        title: t("addSuccess"),
        message:
          bestPos.accuracy < 99
            ? `${t("addSuccessMsg")}${bestPos.accuracy.toFixed(0)}${t("meter")} (${bestPos.numSamples} ${t("sample")})`
            : t("addSuccess"),
        icon: {
          name: "check-circle",
          color: "#34C759",
          lib: "Feather",
          bg: "#E8FAF0",
        },
        confirmText: t("ok"),
        onConfirm: () => {},
      });
    } catch (error) {
      showCustomAlert({
        title: t("gpsError"),
        message: error.message,
        icon: {
          name: "x-circle",
          color: "#FF3B30",
          lib: "Feather",
          bg: "#FFF0F0",
        },
        confirmText: t("ok"),
        onConfirm: () => {},
      });
    }
  };
  const deleteWaypoint = (id) => {
    showCustomAlert({
      title: t("deleteConfirm"),
      message: t("deleteConfirm"),
      icon: {
        name: "trash-2",
        color: "#FF3B30",
        lib: "Feather",
        bg: "#FFF0F0",
      },
      confirmText: t("delete"),
      cancelText: t("cancel"),
      onConfirm: async () => {
        const marker = waypoints.find((w) => w.id === id);
        if (marker?.imageUri)
          try {
            await FileSystem.deleteAsync(marker.imageUri, { idempotent: true });
          } catch (e) {}
        await db.runAsync("DELETE FROM markers WHERE id = ?", [id]);
        if (target?.id === id) setTarget(null);
        loadWaypoints();
        showCustomAlert({
          title: t("waypointDeleted"),
          message: t("waypointDeleted"),
          icon: {
            name: "check-circle",
            color: "#34C759",
            lib: "Feather",
            bg: "#E8FAF0",
          },
          confirmText: t("ok"),
          onConfirm: () => {},
        });
      },
      onCancel: () => {},
    });
  };
  const formatDistance = (d) =>
    d >= 1000 ? (d / 1000).toFixed(2) : Math.round(d).toString();
  const getDistanceUnit = (d) => (d >= 1000 ? t("kmShort") : t("meterShort"));
  const formatSpeed = (s) => (s < 1 ? "0" : s.toString());
  const getIconForType = (type, color, size = 20) => {
    switch (type) {
      case "home":
        return <Feather name="home" size={size} color={color} />;
      case "tent":
        return <FontAwesome5 name="campground" size={size} color={color} />;
      case "mountain":
        return <FontAwesome5 name="mountain" size={size} color={color} />;
      default:
        return <Feather name="flag" size={size} color={color} />;
    }
  };

  // Fetch GPS provider status
  const fetchGpsProviderStatus = async () => {
    try {
      const status = await Location.getProviderStatusAsync();
      setGpsProviderStatus(status);
    } catch (error) {
      console.warn("Failed to get provider status", error);
      setGpsProviderStatus(null);
    }
  };

  const showGpsDetailsModal = async () => {
    await fetchGpsProviderStatus();
    setGpsDetailsModalVisible(true);
  };

  const showNetworkDetailsModal = () => {
    // Build extra details from signalInfo
    let detailsText = "";
    if (signalInfo.details) {
      if (signalInfo.type === "wifi") {
        detailsText = `SSID: ${signalInfo.details.ssid || "N/A"}\nBSSID: ${signalInfo.details.bssid || "N/A"}\nCường độ: ${signalInfo.details.strength ?? "N/A"} dBm`;
      } else if (signalInfo.type === "cellular") {
        detailsText = `Thế hệ: ${signalInfo.details.cellularGeneration || "N/A"}\nNhà mạng: ${signalInfo.details.carrier || "N/A"}\nCường độ: ${signalInfo.details.strength ?? "N/A"} dBm`;
      } else {
        detailsText = JSON.stringify(signalInfo.details, null, 2);
      }
    } else {
      detailsText = "Không có thông tin chi tiết";
    }
    setNetworkExtraDetails(detailsText);
    setNetworkDetailsModalVisible(true);
  };

  const renderSignalStrength = () => {
    let icon, text;
    if (!signalInfo.connected) {
      icon = "wifi-off";
      text = t("signalLost");
    } else if (signalInfo.type === "wifi") {
      icon = "wifi";
      text = t("signalWifi");
    } else if (signalInfo.type === "cellular") {
      icon = "signal";
      const g = signalInfo.details?.cellularGeneration;
      if (g === "2g") text = "2G";
      else if (g === "3g") text = "3G";
      else if (g === "4g") text = "4G";
      else if (g === "5g") text = "5G";
      else text = t("signalCellular");
    } else {
      icon = "cast";
      text = t("signalConnected");
    }
    const isDark = activeTab === "nav";
    return (
      <TouchableOpacity
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: isDark ? "#2C2C2E" : "#E5E5EA",
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 20,
          marginRight: 12,
        }}
        onPress={showNetworkDetailsModal}
      >
        <Feather name={icon} size={14} color={isDark ? "#FFF" : "#1C1C1E"} />
        <Text
          style={{
            fontSize: 12,
            fontWeight: "500",
            color: isDark ? "#FFF" : "#1C1C1E",
            marginLeft: 4,
          }}
        >
          {text}
        </Text>
      </TouchableOpacity>
    );
  };
  const getGpsQualityColor = (acc) => {
    if (!acc) return "#8E8E93";
    if (acc <= 8) return "#34C759";
    if (acc <= 25) return "#FF9F0A";
    return "#FF3B30";
  };
  const renderGpsStatus = () => {
    if (!gpsTimestamp) return null;
    const date = new Date(gpsTimestamp);
    const timeStr = date.toLocaleTimeString();
    const accColor = getGpsQualityColor(gpsAccuracy);
    const accText = gpsAccuracy
      ? "±" + Math.round(gpsAccuracy) + t("meterShort")
      : "...";
    let qualLabel = "";
    if (gpsAccuracy) {
      if (gpsAccuracy <= 8) qualLabel = ` (${t("gpsGood")})`;
      else if (gpsAccuracy <= 25) qualLabel = ` (${t("gpsAverage")})`;
      else qualLabel = ` (${t("gpsPoor")})`;
    }
    return (
      <TouchableOpacity
        style={styles.gpsTimeContainer}
        onPress={showGpsDetailsModal}
      >
        <Feather name="clock" size={11} color="#8E8E93" />
        <Text style={styles.gpsTimeText}>{timeStr}</Text>
        <View
          style={[styles.accuracyBadge, { backgroundColor: accColor + "22" }]}
        >
          <Text style={[styles.accuracyText, { color: accColor }]}>
            {accText}
            {qualLabel}
          </Text>
        </View>
        {headingSource === "location" && (
          <View
            style={[
              styles.accuracyBadge,
              { backgroundColor: "#34C75922", marginLeft: 4 },
            ]}
          >
            <Text style={[styles.accuracyText, { color: "#34C759" }]}>
              {t("compass")}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };
  const renderSpeedAndDirectionStats = () => {
    const dirs = [
      { symbol: "N", name: t("tabNav") }, // just placeholder, actual names not translated
      { symbol: "NE", name: "ĐB" },
      { symbol: "E", name: "Đ" },
      { symbol: "SE", name: "ĐN" },
      { symbol: "S", name: "N" },
      { symbol: "SW", name: "TN" },
      { symbol: "W", name: "T" },
      { symbol: "NW", name: "TB" },
    ];
    const idx = Math.floor(heading / 45 + 0.5) % 8;
    const dir = dirs[idx];
    const spd = speed > 0 ? speed : 0;
    return (
      <View style={styles.statsRowContainer}>
        <View style={[styles.infoBadge, { marginRight: 6 }]}>
          <View style={[styles.iconWrapper, { backgroundColor: "#0A84FF20" }]}>
            <Feather name="wind" size={16} color="#0A84FF" />
          </View>
          <Text style={[styles.infoBadgeMainText, { color: "#0A84FF" }]}>
            {formatSpeed(spd)}
          </Text>
          <Text style={styles.infoBadgeSubText}>{t("speedUnit")}</Text>
        </View>
        <View style={[styles.infoBadge, { marginLeft: 6 }]}>
          <View style={[styles.iconWrapper, { backgroundColor: "#FF9F0A20" }]}>
            <Feather name="compass" size={16} color="#FF9F0A" />
          </View>
          <Text style={[styles.infoBadgeMainText, { color: "#FF9F0A" }]}>
            {dir.symbol}
          </Text>
          <Text style={styles.infoBadgeSubText}>{dir.name}</Text>
        </View>
      </View>
    );
  };

  const renderNavScreen = () => {
    if (!target) {
      return (
        <View
          style={[
            styles.navContainer,
            { justifyContent: "center", alignItems: "center" },
          ]}
        >
          <Feather
            name="map-pin"
            size={64}
            color="#333"
            style={{ marginBottom: 20 }}
          />
          <Text
            style={{ color: "#8E8E93", fontSize: fs(18), textAlign: "center" }}
          >
            {t("noTarget")}
          </Text>
          <Text
            style={{
              color: "#666",
              fontSize: fs(14),
              textAlign: "center",
              marginTop: 8,
            }}
          >
            {t("selectTargetHint")}
          </Text>
          <TouchableOpacity
            style={[
              styles.calibrateButton,
              {
                marginTop: 20,
                backgroundColor: "#0A84FF",
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 20,
                paddingVertical: 12,
                borderRadius: 30,
              },
            ]}
            onPress={() => setLangModalVisible(true)}
          >
            <Feather
              name="globe"
              size={20}
              color="#FFF"
              style={{ marginRight: 8 }}
            />
            <Text style={{ color: "#FFF", fontWeight: "bold" }}>
              {t("language")}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    const dist = location
      ? haversineDistance(location, {
          latitude: target.lat,
          longitude: target.lon,
        })
      : 0;
    const bearing = location
      ? calculateBearing(location, {
          latitude: target.lat,
          longitude: target.lon,
        })
      : 0;
    let delta = (bearing - heading + 360) % 360;
    if (delta > 180) delta -= 360;
    const isCorrect = Math.abs(delta) < 15;
    const distVal = formatDistance(dist),
      distUnit = getDistanceUnit(dist),
      angleVal = Math.abs(Math.round(delta)),
      accentColor = dist <= 10 ? "#34C759" : "#0A84FF";
    return (
      <View style={styles.navContainer}>
        {isInitializingNav && (
          <View style={styles.initOverlay}>
            <ActivityIndicator size="large" color="#0A84FF" />
            <Text style={styles.initText}>{t("preparingGPS")}</Text>
          </View>
        )}
        <View style={styles.navHeader}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <TouchableOpacity
              style={styles.gpsBadge}
              onPress={showGpsDetailsModal}
            >
              <View
                style={[
                  styles.gpsDot,
                  { backgroundColor: location ? "#34C759" : "#FF3B30" },
                ]}
              />
              <Text style={styles.gpsText}>
                {location ? t("gpsStable") : t("gpsSearching")}
              </Text>
            </TouchableOpacity>
            {renderGpsStatus()}
          </View>
          {renderSignalStrength()}
        </View>
        <View style={styles.navInfoTop}>
          <Text style={[styles.navSubText, { fontSize: fs(14) }]}>
            {t("headingTo")}
          </Text>
          <Text
            style={[styles.navTargetText, { fontSize: fs(isSmall ? 20 : 26) }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {target.name}
          </Text>
          <View style={styles.distanceAngleRow}>
            <View style={styles.distanceGroup}>
              <Text
                style={[
                  styles.distanceValue,
                  { fontSize: fs(isSmall ? 36 : 48), color: accentColor },
                ]}
              >
                {distVal}
              </Text>
              <Text
                style={[
                  styles.distanceUnit,
                  { fontSize: fs(isSmall ? 18 : 24), color: accentColor },
                ]}
              >
                {distUnit}
              </Text>
            </View>
            <View style={styles.angleGroup}>
              <Text
                style={[styles.angleValue, { fontSize: fs(isSmall ? 28 : 36) }]}
              >
                {angleVal}°
              </Text>
              <Text
                style={{ color: "#8E8E93", fontSize: fs(11), marginTop: 2 }}
              >
                {t("offCourse")}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.compassWrapper}>
          <View
            style={[
              styles.compassRing,
              {
                width: compassSize,
                height: compassSize,
                borderRadius: compassSize / 2,
                borderColor: accentColor,
              },
            ]}
          >
            <View
              style={[
                styles.arrowContainer,
                { transform: [{ rotate: `${delta}deg` }] },
              ]}
            >
              <Feather
                name="navigation"
                size={arrowIconSize}
                color={accentColor}
              />
            </View>
          </View>
        </View>
        <View style={styles.statusWrapper}>
          <View
            style={[
              styles.statusFeedback,
              { paddingHorizontal: 20, paddingVertical: 10 },
            ]}
          >
            <Feather
              name={isCorrect ? "check-circle" : "alert-circle"}
              size={18}
              color={isCorrect ? "#34C759" : "#FF9F0A"}
            />
            <Text
              style={[
                styles.feedbackText,
                { fontSize: fs(14), color: isCorrect ? "#34C759" : "#FF9F0A" },
              ]}
            >
              {isCorrect
                ? t("correctHeading")
                : delta > 0
                  ? t("turnRight")
                  : t("turnLeft")}
            </Text>
          </View>
        </View>
        {renderSpeedAndDirectionStats()}
        <View style={[styles.actionButtons, isSmall && { marginBottom: 6 }]}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              style={[
                styles.btnSecondary,
                { flex: 1, padding: isSmall ? 14 : 18 },
              ]}
              onPress={() => setTarget(null)}
            >
              <Feather name="x-circle" size={18} color="#FF3B30" />
              <Text
                style={[
                  styles.btnSecondaryText,
                  { fontSize: fs(14), color: "#FF3B30", marginLeft: 6 },
                ]}
              >
                {t("cancelNav")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.btnSecondary,
                {
                  flex: 1,
                  padding: isSmall ? 14 : 18,
                  backgroundColor: "#3A2C2C",
                },
              ]}
              onPress={() => deleteWaypoint(target.id)}
            >
              <Feather name="trash-2" size={18} color="#FF6B6B" />
              <Text
                style={[
                  styles.btnSecondaryText,
                  { fontSize: fs(14), color: "#FF6B6B", marginLeft: 6 },
                ]}
              >
                {t("deleteWaypoint")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.disclaimerText}>{t("disclaimer")}</Text>
      </View>
    );
  };

  const renderListScreen = () => (
    <View style={styles.listContainer}>
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>{t("myMarkers")}</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {renderSignalStrength()}
          <TouchableOpacity
            onPress={() => setAddModalVisible(true)}
            style={styles.addButton}
          >
            <Feather name="plus" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.importExportBar}>
        <TouchableOpacity
          onPress={exportToGeoJSON}
          style={styles.ieButton}
          disabled={isExporting}
        >
          {isExporting ? (
            <ActivityIndicator size="small" color="#0A84FF" />
          ) : (
            <Feather name="upload" size={20} color="#0A84FF" />
          )}
          <Text style={styles.ieButtonText}>{t("exportGeoJSON")}</Text>
        </TouchableOpacity>
        <View style={styles.ieDivider} />
        <TouchableOpacity
          onPress={importFromGeoJSON}
          style={styles.ieButton}
          disabled={isImporting}
        >
          {isImporting ? (
            <ActivityIndicator size="small" color="#0A84FF" />
          ) : (
            <Feather name="download" size={20} color="#0A84FF" />
          )}
          <Text style={styles.ieButtonText}>{t("importGeoJSON")}</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={waypoints}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="map" size={48} color="#D1D1D6" />
            <Text style={styles.emptyText}>{t("emptyMarkers")}</Text>
            <TouchableOpacity
              style={[
                styles.addButton,
                {
                  width: "auto",
                  paddingHorizontal: 20,
                  marginTop: 20,
                  height: 44,
                  borderRadius: 22,
                },
              ]}
              onPress={() => setAddModalVisible(true)}
            >
              <Text style={{ color: "#FFF", fontWeight: "bold" }}>
                {t("addFirst")}
              </Text>
            </TouchableOpacity>
          </View>
        }
        ListFooterComponent={
          <View style={styles.footerContainer}>
            <View style={styles.footerDivider} />
            <View style={styles.footerContent}>
              <Feather name="navigation" size={20} color="#0A84FF" />
              <Text style={styles.footerTitle}>{t("appName")}</Text>
              <Text style={styles.footerVersion}>v1.1.0</Text>
            </View>
            <View style={styles.footerInfoRow}>
              <Feather name="user" size={14} color="#8E8E93" />
              <Text style={styles.footerText}>Phát triển bởi Namtran5905</Text>
            </View>
            <View style={styles.footerInfoRow}>
              <Feather name="shield" size={14} color="#8E8E93" />
              <Text style={styles.footerText}>
                Dẫn đường an toàn, không lạc lối
              </Text>
            </View>
            <View style={styles.footerInfoRow}>
              <Text style={styles.footerText}>© 2026</Text>
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const dist = location
            ? haversineDistance(location, {
                latitude: item.lat,
                longitude: item.lon,
              })
            : 0;
          return (
            <View
              style={[styles.card, target?.id === item.id && styles.cardActive]}
            >
              <TouchableOpacity
                style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
                onPress={() => {
                  setTarget(item);
                  setActiveTab("nav");
                }}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.iconBox,
                    {
                      backgroundColor:
                        target?.id === item.id ? "#0A84FF" : "#E5F0FF",
                    },
                  ]}
                >
                  {getIconForType(
                    item.type,
                    target?.id === item.id ? "#FFF" : "#0A84FF",
                  )}
                </View>
                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardDate}>
                    {new Date(item.timestamp).toLocaleDateString()} -{" "}
                    {new Date(item.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                  <Text style={styles.coordText}>
                    {item.lat.toFixed(6)}, {item.lon.toFixed(6)}
                  </Text>
                  {item.imageUri && (
                    <TouchableOpacity
                      onPress={() => openImageViewer(item.imageUri)}
                      activeOpacity={0.8}
                    >
                      <Image
                        source={{ uri: item.imageUri }}
                        style={styles.thumbnail}
                      />
                    </TouchableOpacity>
                  )}
                  {item.note ? (
                    <Text style={styles.noteText} numberOfLines={2}>
                      {item.note}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.cardRight}>
                  <Text style={styles.cardDist}>
                    {formatDistance(dist)}
                    {getDistanceUnit(dist)}
                  </Text>
                  <Feather name="chevron-right" size={16} color="#C7C7CC" />
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteIcon}
                onPress={() => deleteWaypoint(item.id)}
              >
                <Feather name="trash-2" size={20} color="#FF3B30" />
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </View>
  );
  const renderTimeScreen = () => (
    <ScrollView
      style={styles.timeContainer}
      contentContainerStyle={{ paddingVertical: 20 }}
    >
      <View style={styles.timeCard}>
        <View style={styles.timeCardHeader}>
          <Feather name="globe" size={24} color="#0A84FF" />
          <Text style={styles.timeCardTitle}>{t("utc")}</Text>
        </View>
        <Text style={styles.timeDate}>{utcDate}</Text>
        <Text style={styles.timeTime}>{utcTime}</Text>
      </View>
      <View style={styles.timeCard}>
        <View style={styles.timeCardHeader}>
          <Feather name="map-pin" size={24} color="#0A84FF" />
          <Text style={styles.timeCardTitle}>{t("localTime")}</Text>
        </View>
        <Text style={styles.timeDate}>{localDate}</Text>
        <Text style={styles.timeTime}>{localTime}</Text>
      </View>
      <View style={styles.timeCard}>
        <View style={styles.timeCardHeader}>
          <Feather name="sun" size={24} color="#FF9F0A" />
          <Text style={styles.timeCardTitle}>{t("sun")}</Text>
        </View>
        {isLoadingSun ? (
          <ActivityIndicator
            size="large"
            color="#0A84FF"
            style={{ marginVertical: 20 }}
          />
        ) : (
          <>
            <View style={styles.sunRow}>
              <Feather name="sunrise" size={20} color="#FF9F0A" />
              <Text style={styles.sunLabel}>{t("sunrise")}:</Text>
              <Text style={styles.sunValue}>{sunrise || "--:--"}</Text>
            </View>
            <View style={styles.sunRow}>
              <Feather name="sunset" size={20} color="#FF9F0A" />
              <Text style={styles.sunLabel}>{t("sunset")}:</Text>
              <Text style={styles.sunValue}>{sunset || "--:--"}</Text>
            </View>
          </>
        )}
        {location && (
          <Text style={styles.timeLocationNote}>
            {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
          </Text>
        )}
      </View>
    </ScrollView>
  );
  const renderMap2DScreen = () => (
    <View style={{ flex: 1, backgroundColor: "#FFF" }}>
      <CustomMap2D
        waypoints={waypoints}
        currentLocation={location}
        trackPoints={trackPoints}
        onSelectWaypoint={(wp) => {
          setTarget(wp);
          setActiveTab("nav");
        }}
        onDeleteWaypoint={(id) => deleteWaypoint(id)}
      />
    </View>
  );
  const renderAddModal = () => (
    <Modal
      visible={isAddModalVisible}
      animationType="slide"
      transparent={false}
    >
      <SafeAreaView style={styles.modalContainer} edges={["top"]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                setAddModalVisible(false);
                setNewName("");
                setNewNote("");
                setNewImageUri(null);
              }}
            >
              <Feather name="x" size={28} color="#1C1C1E" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{t("addMarker")}</Text>
            <View style={{ width: 28 }} />
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={styles.radarContainer}>
              {isAcquiringPos ? (
                <>
                  <View style={styles.radarCircle1}>
                    <View style={styles.radarCircle2}>
                      <View style={styles.radarDot} />
                    </View>
                  </View>
                  <View style={{ marginTop: 12, alignItems: "center" }}>
                    <Text
                      style={[
                        styles.radarText,
                        { color: "#FF9F0A", fontWeight: "700" },
                      ]}
                    >
                      {t("acquiringGPS")} {acquisitionProgress}%
                    </Text>
                    <View style={styles.progressBarTrack}>
                      <View
                        style={[
                          styles.progressBarFill,
                          { width: acquisitionProgress + "%" },
                        ]}
                      />
                    </View>
                    <Text
                      style={{
                        fontSize: 11,
                        color: "#8E8E93",
                        marginTop: 6,
                        textAlign: "center",
                      }}
                    >
                      {t("holdSteady")}
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.radarCircle1}>
                    <View style={styles.radarCircle2}>
                      <View style={styles.radarDot} />
                    </View>
                  </View>
                  <View style={styles.radarTextWrap}>
                    {location ? (
                      <>
                        <Feather
                          name="check-circle"
                          size={14}
                          color="#34C759"
                          style={{ marginRight: 6 }}
                        />
                        <Text style={[styles.radarText, { color: "#34C759" }]}>
                          {t("gpsReady")}
                        </Text>
                        {gpsAccuracy && (
                          <View
                            style={[
                              styles.accuracyBadge,
                              {
                                marginLeft: 8,
                                backgroundColor:
                                  gpsAccuracy <= 8
                                    ? "#E8FAF0"
                                    : gpsAccuracy <= 20
                                      ? "#FFF8E7"
                                      : "#FFF0F0",
                              },
                            ]}
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: "600",
                                color:
                                  gpsAccuracy <= 8
                                    ? "#34C759"
                                    : gpsAccuracy <= 20
                                      ? "#FF9F0A"
                                      : "#FF3B30",
                              }}
                            >
                              ±{Math.round(gpsAccuracy)}
                              {t("meterShort")}
                            </Text>
                          </View>
                        )}
                      </>
                    ) : (
                      <Text style={[styles.radarText, { color: "#FF9F0A" }]}>
                        {t("gpsWaiting")}
                      </Text>
                    )}
                  </View>
                  {!location && (
                    <TouchableOpacity
                      onPress={getCurrentLocationOnce}
                      style={styles.retryLocationBtn}
                    >
                      <Text style={styles.retryLocationText}>{t("retry")}</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>{t("markerName")}</Text>
              <TextInput
                style={styles.input}
                placeholder="VD: Chỗ đỗ xe..."
                placeholderTextColor="#8E8E93"
                value={newName}
                onChangeText={setNewName}
                autoFocus
              />
              <Text style={[styles.inputLabel, { marginTop: 20 }]}>
                {t("markerNote")}
              </Text>
              <TextInput
                style={[styles.input, styles.inputArea]}
                placeholder="Mô tả thêm..."
                placeholderTextColor="#8E8E93"
                multiline
                value={newNote}
                onChangeText={setNewNote}
              />
              <Text style={[styles.inputLabel, { marginTop: 20 }]}>
                {t("markerPhoto")}
              </Text>
              <TouchableOpacity
                style={styles.imagePickerButton}
                onPress={pickImage}
              >
                <Feather name="camera" size={24} color="#0A84FF" />
                <Text style={styles.imagePickerText}>{t("takePhoto")}</Text>
              </TouchableOpacity>
              {newImageUri && (
                <View style={styles.imagePreviewContainer}>
                  <Image
                    source={{ uri: newImageUri }}
                    style={styles.imagePreview}
                  />
                  <TouchableOpacity
                    style={styles.removeImageBtn}
                    onPress={() => setNewImageUri(null)}
                  >
                    <Feather name="x-circle" size={24} color="#FF3B30" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ScrollView>
          <TouchableOpacity
            style={[
              styles.saveBtn,
              (!location || isAcquiringPos) && { opacity: 0.55 },
            ]}
            onPress={saveWaypoint}
            disabled={!location || isAcquiringPos}
          >
            <Text style={styles.saveBtnText}>
              {isAcquiringPos ? t("acquiringGPS") : t("saveMarker")}
            </Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
  const renderAlertIcon = (icon) => {
    if (!icon) return null;
    if (typeof icon === "string")
      return <Text style={styles.alertIcon}>{icon}</Text>;
    const { name, color = "#0A84FF", lib = "Feather", size = 36 } = icon;
    if (lib === "FontAwesome5")
      return <FontAwesome5 name={name} size={size} color={color} />;
    return <Feather name={name} size={size} color={color} />;
  };
  const renderCustomAlert = () => {
    const ic = customAlertData.icon;
    const bgColor = ic && typeof ic === "object" ? ic.bg : "#F2F2F7";
    return (
      <Modal
        visible={customAlertVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomAlertVisible(false)}
      >
        <View style={styles.alertOverlay}>
          <View style={styles.alertCard}>
            <View
              style={[styles.alertIconContainer, { backgroundColor: bgColor }]}
            >
              {renderAlertIcon(ic)}
            </View>
            <Text style={styles.alertTitle}>{customAlertData.title}</Text>
            <Text style={styles.alertMessage}>{customAlertData.message}</Text>
            <View style={styles.alertButtonContainer}>
              {customAlertData.cancelText && (
                <TouchableOpacity
                  style={[styles.alertButton, styles.alertButtonCancel]}
                  onPress={customAlertData.onCancel}
                >
                  <Text style={[styles.alertButtonText, { color: "#0A84FF" }]}>
                    {customAlertData.cancelText}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.alertButton, styles.alertButtonConfirm]}
                onPress={customAlertData.onConfirm}
              >
                <Text style={styles.alertButtonText}>
                  {customAlertData.confirmText}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  // Render GPS details modal (without altitude)
  const renderGpsDetailsModal = () => (
    <Modal visible={gpsDetailsModalVisible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={[styles.infoCard, { maxHeight: "80%" }]}>
          <View style={styles.infoHeader}>
            <Text style={styles.infoTitle}>{t("gpsDetails")}</Text>
            <TouchableOpacity onPress={() => setGpsDetailsModalVisible(false)}>
              <Feather name="x" size={24} color="#1E293B" />
            </TouchableOpacity>
          </View>
          <ScrollView>
            <Text style={styles.detailLabel}>📍 {t("rawLatitude")}</Text>
            <Text style={styles.detailValue}>
              {rawLocation?.latitude ?? "N/A"}
            </Text>
            <Text style={styles.detailLabel}>📍 {t("rawLongitude")}</Text>
            <Text style={styles.detailValue}>
              {rawLocation?.longitude ?? "N/A"}
            </Text>
            <Text style={styles.detailLabel}>🎯 {t("filtered")}</Text>
            <Text style={styles.detailValue}>
              {location ? `${location.latitude}, ${location.longitude}` : "N/A"}
            </Text>
            <Text style={styles.detailLabel}>📏 {t("accuracy")}</Text>
            <Text style={styles.detailValue}>
              {gpsAccuracy ? `±${Math.round(gpsAccuracy)}m` : "N/A"}
            </Text>
            <Text style={styles.detailLabel}>🧭 {t("compass")}</Text>
            <Text
              style={styles.detailValue}
            >{`${Math.round(heading)}° (${headingSource})`}</Text>
            <Text style={styles.detailLabel}>🕒 {t("gpsTimestamp")}</Text>
            <Text style={styles.detailValue}>
              {gpsTimestamp ? new Date(gpsTimestamp).toLocaleString() : "N/A"}
            </Text>
            <Text style={styles.detailLabel}>📡 {t("provider")}</Text>
            <Text style={styles.detailValue}>
              {gpsProviderStatus
                ? JSON.stringify(gpsProviderStatus, null, 2)
                : "Đang lấy..."}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const renderNetworkDetailsModal = () => (
    <Modal
      visible={networkDetailsModalVisible}
      transparent
      animationType="fade"
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.infoCard, { maxHeight: "80%" }]}>
          <View style={styles.infoHeader}>
            <Text style={styles.infoTitle}>{t("networkDetails")}</Text>
            <TouchableOpacity
              onPress={() => setNetworkDetailsModalVisible(false)}
            >
              <Feather name="x" size={24} color="#1E293B" />
            </TouchableOpacity>
          </View>
          <ScrollView>
            <Text style={styles.detailLabel}>📡 {t("networkType")}</Text>
            <Text style={styles.detailValue}>{signalInfo.type || "N/A"}</Text>
            <Text style={styles.detailLabel}>🔌 {t("signalConnected")}</Text>
            <Text style={styles.detailValue}>
              {signalInfo.connected ? "Yes" : "No"}
            </Text>
            <Text style={styles.detailLabel}>📶 {t("signalStrength")}</Text>
            <Text style={styles.detailValue}>
              {signalInfo.details?.strength !== undefined
                ? `${signalInfo.details.strength} dBm`
                : "N/A"}
            </Text>
            {signalInfo.type === "wifi" && (
              <>
                <Text style={styles.detailLabel}>🏷️ SSID</Text>
                <Text style={styles.detailValue}>
                  {signalInfo.details?.ssid || "N/A"}
                </Text>
                <Text style={styles.detailLabel}>🔗 BSSID</Text>
                <Text style={styles.detailValue}>
                  {signalInfo.details?.bssid || "N/A"}
                </Text>
              </>
            )}
            {signalInfo.type === "cellular" && (
              <>
                <Text style={styles.detailLabel}>📱 {t("carrier")}</Text>
                <Text style={styles.detailValue}>
                  {signalInfo.details?.carrier || "N/A"}
                </Text>
                <Text style={styles.detailLabel}>⚡ {t("networkType")}</Text>
                <Text style={styles.detailValue}>
                  {signalInfo.details?.cellularGeneration || "N/A"}
                </Text>
              </>
            )}
            <Text style={styles.detailLabel}>🔍 Chi tiết thô</Text>
            <Text style={styles.detailValue}>
              {networkExtraDetails || "Không có"}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  if (!isReady) return null;
  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: activeTab === "nav" ? "#071521" : "#F6F8FB" },
      ]}
    >
      <StatusBar
        barStyle={activeTab === "nav" ? "light-content" : "dark-content"}
      />
      {activeTab === "nav"
        ? renderNavScreen()
        : activeTab === "list"
          ? renderListScreen()
          : activeTab === "time"
            ? renderTimeScreen()
            : renderMap2DScreen()}
      {renderAddModal()}
      {renderCustomAlert()}
      {renderGpsDetailsModal()}
      {renderNetworkDetailsModal()}
      <Modal
        visible={imageViewerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImageViewerVisible(false)}
      >
        <View style={styles.imageViewerContainer}>
          <TouchableOpacity
            style={styles.imageViewerClose}
            onPress={() => setImageViewerVisible(false)}
          >
            <Feather name="x" size={28} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.imageViewerDownload}
            onPress={saveImageToDevice}
          >
            <Feather name="download" size={24} color="#FFF" />
          </TouchableOpacity>
          {selectedImageUri && (
            <Image
              source={{ uri: selectedImageUri }}
              style={styles.imageViewerImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: activeTab === "nav" ? "#0D2232" : "#FFFFFF",
            borderTopColor: activeTab === "nav" ? "#1B3A4F" : "#E8EDF3",
          },
        ]}
      >
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab("nav")}
        >
          <Feather
            name="navigation"
            size={24}
            color={activeTab === "nav" ? "#0A84FF" : "#8E8E93"}
          />
          <Text
            style={[
              styles.tabText,
              { color: activeTab === "nav" ? "#0A84FF" : "#8E8E93" },
            ]}
          >
            {t("tabNav")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab("list")}
        >
          <Feather
            name="flag"
            size={24}
            color={activeTab === "list" ? "#0A84FF" : "#8E8E93"}
          />
          <Text
            style={[
              styles.tabText,
              { color: activeTab === "list" ? "#0A84FF" : "#8E8E93" },
            ]}
          >
            {t("tabList")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab("time")}
        >
          <Feather
            name="clock"
            size={24}
            color={activeTab === "time" ? "#0A84FF" : "#8E8E93"}
          />
          <Text
            style={[
              styles.tabText,
              { color: activeTab === "time" ? "#0A84FF" : "#8E8E93" },
            ]}
          >
            {t("tabTime")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab("map2d")}
        >
          <Feather
            name="map"
            size={24}
            color={activeTab === "map2d" ? "#0A84FF" : "#8E8E93"}
          />
          <Text
            style={[
              styles.tabText,
              { color: activeTab === "map2d" ? "#0A84FF" : "#8E8E93" },
            ]}
          >
            {t("tab2D")}
          </Text>
        </TouchableOpacity>
      </View>
      <Modal visible={langModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.infoCard}>
            <View style={styles.infoHeader}>
              <Text style={styles.infoTitle}>{t("selectLanguage")}</Text>
              <TouchableOpacity onPress={() => setLangModalVisible(false)}>
                <Feather name="x" size={24} color="#1E293B" />
              </TouchableOpacity>
            </View>
            {["vi", "en", "zh", "fr", "es", "ko"].map((lang) => (
              <TouchableOpacity
                key={lang}
                style={{
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: "#E2E8F0",
                }}
                onPress={() => changeLanguage(lang)}
              >
                <Text style={{ fontSize: 16 }}>
                  {t(
                    lang === "vi"
                      ? "vietnamese"
                      : lang === "en"
                        ? "english"
                        : lang === "zh"
                          ? "chinese"
                          : lang === "fr"
                            ? "french"
                            : lang === "es"
                              ? "spanish"
                              : "korean",
                  )}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  nativeMapContainer: { flex: 1, backgroundColor: "#EAF0F5" },
  nativeMapControls: { position: "absolute", left: 12, top: 12, gap: 8 },
  nativeMapButton: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.94)",
    alignItems: "center", justifyContent: "center", elevation: 4,
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  nativeMapBadge: {
    position: "absolute", right: 10, bottom: 10, paddingHorizontal: 9, paddingVertical: 5,
    borderRadius: 8, backgroundColor: "rgba(255,255,255,0.88)",
  },
  nativeMapBadgeText: { fontSize: 11, color: "#1C1C1E", fontWeight: "600" },
  navContainer: {
    flex: 1,
    backgroundColor: "#071521",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  navHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: 8,
    marginBottom: 8,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "#102536",
    borderWidth: 1,
    borderColor: "#1D4058",
    flexWrap: "nowrap",
  },
  gpsBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#17364A",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  gpsDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
  gpsText: { color: "#FFF", fontSize: 11, fontWeight: "600" },
  gpsTimeContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    marginLeft: 2,
    flexWrap: "wrap",
    maxWidth: "100%",
  },
  gpsTimeText: { fontSize: 10, color: "#8E8E93", marginLeft: 4, flexShrink: 1 },
  accuracyBadge: {
    backgroundColor: "#2C2C2E",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  accuracyText: { fontSize: 10, color: "#0A84FF", fontWeight: "500" },
  navInfoTop: {
    alignItems: "center", marginTop: 4, marginBottom: 4, padding: 14,
    borderRadius: 22, backgroundColor: "#0E2435", borderWidth: 1, borderColor: "#1A4058",
  },
  navSubText: { color: "#8FB5C9", fontSize: 16, letterSpacing: 0.5 },
  navTargetText: {
    color: "#FFF", fontWeight: "800", marginTop: 4, textAlign: "center",
    maxWidth: "90%", letterSpacing: 0.3,
  },
  distanceAngleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    width: "100%",
    marginTop: 10,
    paddingHorizontal: 16,
  },
  distanceGroup: { flexDirection: "row", alignItems: "baseline" },
  distanceValue: { fontWeight: "bold" },
  distanceUnit: { fontWeight: "600", marginLeft: 6 },
  angleGroup: { alignItems: "flex-end" },
  angleValue: { color: "#FFF", fontWeight: "bold" },
  compassWrapper: {
    alignItems: "center", justifyContent: "center", marginVertical: 12,
    paddingVertical: 10, borderRadius: 28, backgroundColor: "#0A1D2D",
  },
  compassRing: {
    borderWidth: 3, borderStyle: "solid", alignItems: "center", justifyContent: "center",
    backgroundColor: "#102E43", shadowColor: "#000", shadowOpacity: 0.35,
    shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  arrowContainer: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  statusWrapper: { alignItems: "center", marginBottom: 15 },
  statusFeedback: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#102536",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  feedbackText: { fontSize: 15, fontWeight: "600", marginLeft: 6 },
  statsRowContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: 10,
  },
  infoBadge: {
    flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#102536",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2C2C2E",
  },
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  infoBadgeMainText: { fontSize: 20, fontWeight: "bold" },
  infoBadgeSubText: {
    color: "#8E8E93",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 4,
    marginTop: 4,
  },
  actionButtons: { width: "100%", marginTop: 10 },
  btnSecondary: {
    flexDirection: "row", backgroundColor: "#17364A",
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSecondaryText: { fontSize: 16, fontWeight: "bold", marginLeft: 8 },
  disclaimerText: {
    textAlign: "center",
    fontSize: 12,
    color: "#FF9F0A",
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  initOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  initText: { color: "#FFF", marginTop: 12, fontSize: 16, fontWeight: "500" },
  listContainer: { flex: 1, backgroundColor: "#F6F8FB" },
  listHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
  },
  listTitle: { fontSize: 30, fontWeight: "800", color: "#102536", letterSpacing: -0.4 },
  addButton: {
    backgroundColor: "#0B84F3",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0A84FF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 100,
  },
  emptyText: { color: "#8E8E93", fontSize: 16, marginTop: 16 },
  card: {
    flexDirection: "row", backgroundColor: "#FFFFFF", padding: 15, borderRadius: 22,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 3, borderWidth: 1, borderColor: "#EDF1F5",
  },
  cardActive: { borderWidth: 2, borderColor: "#0A84FF" },
  iconBox: {
    width: 52, height: 52, borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 15,
  },
  cardContent: { flex: 1 },
  cardTitle: {
    fontSize: 17, fontWeight: "800", color: "#122536",
    marginBottom: 4,
  },
  cardDate: { fontSize: 12, color: "#8E8E93" },
  coordText: { fontSize: 11, color: "#8E8E93", marginTop: 2 },
  noteText: { fontSize: 12, color: "#6C6C70", marginTop: 4 },
  thumbnail: { width: 80, height: 80, borderRadius: 12, marginTop: 8 },
  cardRight: { flexDirection: "row", alignItems: "center", marginRight: 8 },
  cardDist: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#1C1C1E",
    marginRight: 8,
  },
  deleteIcon: { padding: 8, marginLeft: 4 },
  modalContainer: { flex: 1, backgroundColor: "#FFF" },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 10 : 20,
    marginBottom: 10,
  },
  modalTitle: { fontSize: 20, fontWeight: "bold", color: "#1C1C1E" },
  radarContainer: { alignItems: "center", marginVertical: 20 },
  radarCircle1: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#E5F0FF",
    alignItems: "center",
    justifyContent: "center",
  },
  radarCircle2: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#CCE0FF",
    alignItems: "center",
    justifyContent: "center",
  },
  radarDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#0A84FF",
    shadowColor: "#0A84FF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  radarTextWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  progressBarTrack: {
    width: 200,
    height: 6,
    backgroundColor: "#E5E5EA",
    borderRadius: 3,
    marginTop: 10,
    overflow: "hidden",
  },
  progressBarFill: { height: 6, backgroundColor: "#FF9F0A", borderRadius: 3 },
  radarText: { fontSize: 15, color: "#1C1C1E", fontWeight: "500" },
  retryLocationBtn: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#0A84FF",
    borderRadius: 20,
  },
  retryLocationText: { color: "#FFF", fontSize: 12, fontWeight: "bold" },
  inputSection: { paddingHorizontal: 20 },
  inputLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#F2F2F7",
    borderRadius: 16,
    padding: 16,
    fontSize: 16,
    color: "#1C1C1E",
  },
  inputArea: { height: 100, paddingTop: 16, textAlignVertical: "top" },
  imagePickerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F2F2F7",
    padding: 14,
    borderRadius: 16,
    marginTop: 8,
  },
  imagePickerText: {
    fontSize: 16,
    color: "#0A84FF",
    marginLeft: 8,
    fontWeight: "500",
  },
  imagePreviewContainer: {
    marginTop: 12,
    alignItems: "center",
    position: "relative",
  },
  imagePreview: { width: 120, height: 120, borderRadius: 16 },
  removeImageBtn: {
    position: "absolute",
    top: -8,
    right: -8,
    backgroundColor: "#FFF",
    borderRadius: 12,
  },
  saveBtn: {
    backgroundColor: "#0A84FF",
    padding: 18,
    borderRadius: 20,
    alignItems: "center",
    margin: 20,
    marginBottom: Platform.OS === "ios" ? 30 : 20,
  },
  saveBtnText: { color: "#FFF", fontSize: 18, fontWeight: "bold" },
  bottomBar: {
    flexDirection: "row", paddingTop: 9, paddingBottom: Platform.OS === "ios" ? 24 : 10,
    borderTopWidth: 1, shadowColor: "#123", shadowOpacity: 0.08, shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 }, elevation: 12,
  },
  tabItem: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 48 },
  tabText: { fontSize: 11, fontWeight: "700", marginTop: 5, letterSpacing: 0.1 },
  alertOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  alertCard: {
    width: "88%",
    maxWidth: 420,
    backgroundColor: "#FFF",
    borderRadius: 28,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 15,
  },
  alertIconContainer: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "#F2F2F7",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  alertIcon: { fontSize: 40 },
  alertTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#1C1C1E",
    textAlign: "center",
    marginBottom: 12,
  },
  alertMessage: {
    fontSize: 16,
    color: "#8E8E93",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  alertButtonContainer: {
    flexDirection: "row",
    justifyContent: "center",
    width: "100%",
    gap: 12,
  },
  alertButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 30,
    minWidth: 100,
    alignItems: "center",
  },
  alertButtonConfirm: { backgroundColor: "#0A84FF" },
  alertButtonCancel: {
    backgroundColor: "#F2F2F7",
    borderWidth: 1,
    borderColor: "#C7C7CC",
  },
  alertButtonText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
  footerContainer: { marginTop: 24, marginBottom: 16, alignItems: "center" },
  footerDivider: {
    width: 60,
    height: 4,
    backgroundColor: "#E5E5EA",
    borderRadius: 2,
    marginBottom: 16,
  },
  footerContent: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 12,
  },
  footerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
    marginLeft: 8,
  },
  footerVersion: {
    fontSize: 12,
    fontWeight: "400",
    color: "#8E8E93",
    marginLeft: 6,
  },
  footerInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 4,
  },
  footerText: { fontSize: 13, color: "#8E8E93", marginLeft: 6 },
  imageViewerContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  imageViewerClose: {
    position: "absolute",
    top: Platform.OS === "ios" ? 50 : 30,
    right: 20,
    zIndex: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 30,
    padding: 8,
  },
  imageViewerDownload: {
    position: "absolute",
    top: Platform.OS === "ios" ? 50 : 30,
    left: 20,
    zIndex: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 30,
    padding: 8,
  },
  imageViewerImage: { width: "100%", height: "100%" },
  importExportBar: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
    backgroundColor: "#FFF",
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 8,
    borderRadius: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.09, shadowRadius: 14, elevation: 3,
  },
  ieButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  ieButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#0A84FF",
    marginLeft: 6,
  },
  ieDivider: { width: 1, height: 24, backgroundColor: "#E5E5EA" },
  timeContainer: { flex: 1, backgroundColor: "#F6F8FB", paddingHorizontal: 16 },
  timeCard: {
    backgroundColor: "#FFFFFF", borderRadius: 24, padding: 22, marginBottom: 16,
    borderWidth: 1, borderColor: "#EAF0F5", shadowColor: "#123",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  timeCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5EA",
    paddingBottom: 10,
  },
  timeCardTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1C1C1E",
    marginLeft: 10,
  },
  timeDate: {
    fontSize: 18,
    color: "#8E8E93",
    textAlign: "center",
    marginBottom: 8,
  },
  timeTime: {
    fontSize: 36,
    fontWeight: "700",
    color: "#0A84FF",
    textAlign: "center",
    letterSpacing: 1,
  },
  sunRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 8,
  },
  sunLabel: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1C1C1E",
    marginHorizontal: 8,
  },
  sunValue: { fontSize: 18, fontWeight: "500", color: "#FF9F0A" },
  timeLocationNote: {
    fontSize: 12,
    color: "#8E8E93",
    textAlign: "center",
    marginTop: 16,
    fontStyle: "italic",
  },
  scaleBarContainer: {
    position: "absolute",
    bottom: 20,
    left: 20,
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignItems: "center",
  },
  scaleBar: {
    height: 4,
    backgroundColor: "#1E293B",
    marginVertical: 4,
    position: "relative",
  },
  scaleTickLeft: {
    position: "absolute",
    left: 0,
    top: -4,
    width: 2,
    height: 12,
    backgroundColor: "#1E293B",
  },
  scaleTickRight: {
    position: "absolute",
    right: 0,
    top: -4,
    width: 2,
    height: 12,
    backgroundColor: "#1E293B",
  },
  scaleText: { fontSize: 12, color: "#1E293B", fontWeight: "500" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  infoCard: {
    width: "85%",
    backgroundColor: "#FFF",
    borderRadius: 24,
    padding: 20,
    elevation: 10,
  },
  infoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  infoTitle: { fontSize: 20, fontWeight: "bold", color: "#1E293B" },
  infoImage: {
    width: "100%",
    height: 200,
    borderRadius: 12,
    marginVertical: 12,
  },
  infoNote: { fontSize: 14, color: "#475569", marginBottom: 8 },
  infoCoord: { fontSize: 12, color: "#64748B", marginBottom: 4 },
  infoDate: { fontSize: 12, color: "#64748B", marginBottom: 16 },
  infoActions: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 8,
  },
  infoButton: {
    backgroundColor: "#0A84FF",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 30,
  },
  infoButtonDelete: { backgroundColor: "#FEE2E2" },
  infoButtonText: { color: "#FFF", fontWeight: "600" },
  centerButton: {
    position: "absolute",
    bottom: 80,
    right: 20,
    zIndex: 100,
    backgroundColor: "#0A84FF",
    padding: 12,
    borderRadius: 30,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  resetButton: {
    position: "absolute",
    bottom: 20,
    right: 20,
    zIndex: 100,
    backgroundColor: "#1E293B",
    padding: 10,
    borderRadius: 30,
    elevation: 4,
  },
  // v1.1.2: cột nút bản đồ dọc gọn bên trái (trên nút target)
  mapButtonsColumn: {
    position: "absolute",
    bottom: 136,
    left: 14,
    zIndex: 100,
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  mapIconButton: {
    backgroundColor: "#1E293B",
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
  },
  downloadToast: {
    position: "absolute",
    top: 10,
    left: 14,
    right: 14,
    zIndex: 100,
    backgroundColor: "rgba(30, 41, 59, 0.9)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  downloadToastText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  mapAttribution: {
    position: "absolute",
    bottom: 8,
    left: 10,
    zIndex: 100,
    fontSize: 8,
    color: "#94A3B8",
    backgroundColor: "rgba(255,255,255,0.7)",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  calibrateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0A84FF",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 30,
    marginTop: 30,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1E293B",
    marginTop: 8,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    color: "#475569",
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 4,
  },
});
